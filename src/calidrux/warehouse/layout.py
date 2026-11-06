"""Warehouse layout engine — size, zoning and slot generation.

A layout is a grid of aisles x bays x levels. Every (aisle, bay, level) is one
storage slot (a ``Location``). Applying a new layout reconciles the grid with
the slots already in the database:

* positions that already have a slot keep it (and its stock, history and code);
* new positions get a freshly generated slot;
* slots outside the new grid are *deactivated*, never deleted, so movement and
  pick history stays intact;
* the change is refused if it would strand stock (removing a stocked slot, or
  flipping a stocked slot between cold and ambient).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from calidrux.db.models.inventory import Inventory
from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.warehouse import WarehouseLayout
from calidrux.services.audit import log_action

LIMITS = {
    "aisles": (1, 30),
    "bays_per_aisle": (1, 40),
    "levels": (1, 8),
}


def _q(d) -> str:
    """Human quantity: 1000 not 1000.00."""
    return f"{float(d):,.10g}"


class LayoutError(Exception):
    pass


class LayoutConflict(LayoutError):
    def __init__(self, plan: dict[str, Any]) -> None:
        self.plan = plan
        n = len(plan["blocked"])
        super().__init__(f"{n} slot{'s' if n != 1 else ''} still hold stock and block this layout")


@dataclass
class LayoutSpec:
    name: str = "Main Warehouse"
    aisles: int = 6
    bays_per_aisle: int = 8
    levels: int = 4
    cold_aisles: list[int] = field(default_factory=lambda: [6])
    slot_capacity_units: int = 1000
    cold_slot_capacity_units: int = 400
    max_weight_kg: int = 500
    cold_max_weight_kg: int = 200
    aisle_spacing_m: float = 3.5
    bay_width_m: float = 2.7

    def validate(self) -> None:
        for key, (lo, hi) in LIMITS.items():
            value = getattr(self, key)
            if not lo <= value <= hi:
                raise LayoutError(f"{key.replace('_', ' ')} must be between {lo} and {hi}")
        bad = [a for a in self.cold_aisles if not 1 <= a <= self.aisles]
        if bad:
            raise LayoutError(f"Cold aisle(s) {bad} are outside 1..{self.aisles}")
        for key in ("slot_capacity_units", "cold_slot_capacity_units",
                    "max_weight_kg", "cold_max_weight_kg"):
            if getattr(self, key) <= 0:
                raise LayoutError(f"{key.replace('_', ' ')} must be positive")
        if self.aisle_spacing_m <= 0 or self.bay_width_m <= 0:
            raise LayoutError("Aisle spacing and bay width must be positive")
        self.cold_aisles = sorted(set(int(a) for a in self.cold_aisles))

    def is_cold(self, aisle: int) -> bool:
        return aisle in self.cold_aisles

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def slot_code(aisle: int, bay: int, level: int, cold: bool) -> str:
    return f"{'C' if cold else 'A'}{aisle:02d}-B{bay:02d}-L{level}"


def slot_coords(spec: LayoutSpec, aisle: int, bay: int) -> tuple[float, float]:
    """Floor position in metres; the dock/dispatch point sits at the origin."""
    return round(spec.aisle_spacing_m * aisle, 2), round(spec.bay_width_m * bay, 2)


# ── Reading the current layout ────────────────────────────────────────────────

def get_layout(session: Session) -> tuple[LayoutSpec, bool]:
    """Return (layout, inferred). ``inferred`` is True when no layout has been
    saved yet and it was derived from the existing slots."""
    row = session.query(WarehouseLayout).first()
    if row:
        d = row.to_dict()
        return LayoutSpec(**d), False

    locs = session.query(Location).filter(Location.active.is_(True)).all()
    if not locs:
        return LayoutSpec(), True
    by_aisle: dict[int, list[Location]] = defaultdict(list)
    for loc in locs:
        by_aisle[loc.aisle].append(loc)
    cold = [a for a, ls in by_aisle.items() if all(l.zone_type == ZoneType.COLD for l in ls)]
    ambient = [l for l in locs if l.zone_type == ZoneType.AMBIENT]
    cold_locs = [l for l in locs if l.zone_type == ZoneType.COLD]
    spec = LayoutSpec(
        aisles=max(1, min(LIMITS["aisles"][1], max(l.aisle for l in locs))),
        bays_per_aisle=max(1, min(LIMITS["bays_per_aisle"][1], max(l.bay for l in locs))),
        levels=max(1, min(LIMITS["levels"][1], max(l.level for l in locs))),
        cold_aisles=sorted(cold),
        slot_capacity_units=ambient[0].capacity_units if ambient else 1000,
        cold_slot_capacity_units=cold_locs[0].capacity_units if cold_locs else 400,
        max_weight_kg=ambient[0].max_weight_kg if ambient else 500,
        cold_max_weight_kg=cold_locs[0].max_weight_kg if cold_locs else 200,
    )
    return spec, True


# ── Planning / applying ───────────────────────────────────────────────────────

def _stock_by_location(session: Session) -> dict[int, Decimal]:
    rows = (
        session.query(Inventory.location_id, func.sum(Inventory.quantity))
        .filter(Inventory.quantity > 0)
        .group_by(Inventory.location_id)
        .all()
    )
    return {loc_id: qty for loc_id, qty in rows}


def _index_positions(locs: list[Location]) -> dict[tuple[int, int, int], Location]:
    by_pos: dict[tuple[int, int, int], Location] = {}
    for loc in sorted(locs, key=lambda l: (not l.active, l.id)):
        by_pos.setdefault((loc.aisle, loc.bay, loc.level), loc)
    return by_pos


def plan_layout(session: Session, spec: LayoutSpec) -> dict[str, Any]:
    spec.validate()
    locs = session.query(Location).all()
    by_pos = _index_positions(locs)
    stock = _stock_by_location(session)

    target = {
        (a, b, l)
        for a in range(1, spec.aisles + 1)
        for b in range(1, spec.bays_per_aisle + 1)
        for l in range(1, spec.levels + 1)
    }

    create: list[tuple[int, int, int]] = []
    keep: list[Location] = []
    blocked: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    for pos in sorted(target):
        zone = ZoneType.COLD if spec.is_cold(pos[0]) else ZoneType.AMBIENT
        cap = spec.cold_slot_capacity_units if zone == ZoneType.COLD else spec.slot_capacity_units
        loc = by_pos.get(pos)
        if loc is None:
            create.append(pos)
            continue
        keep.append(loc)
        qty = stock.get(loc.id, Decimal("0"))
        if qty > 0 and loc.zone_type != zone:
            blocked.append({
                "code": loc.code,
                "reason": f"holds {_q(qty)} units and can't switch to {zone.value}",
            })
        elif qty > cap:
            warnings.append({
                "code": loc.code,
                "reason": f"holds {_q(qty)} units, over the new {cap}-unit capacity",
            })

    keep_ids = {l.id for l in keep}
    deactivate: list[Location] = []
    for loc in locs:
        if loc.active and loc.id not in keep_ids:
            qty = stock.get(loc.id, Decimal("0"))
            if qty > 0:
                blocked.append({
                    "code": loc.code,
                    "reason": f"holds {_q(qty)} units — move them before removing this slot",
                })
            else:
                deactivate.append(loc)

    cold_slots = len(spec.cold_aisles) * spec.bays_per_aisle * spec.levels
    total = spec.aisles * spec.bays_per_aisle * spec.levels
    return {
        "layout": spec.to_dict(),
        "summary": {
            "total_slots": total,
            "cold_slots": cold_slots,
            "ambient_slots": total - cold_slots,
            "racks": spec.aisles * spec.bays_per_aisle,
            "add": len(create),
            "keep": len(keep),
            "remove": len(deactivate),
            "floor_area_m2": round(
                (spec.aisles + 1) * spec.aisle_spacing_m
                * (spec.bays_per_aisle + 1) * spec.bay_width_m, 1),
        },
        "blocked": blocked,
        "warnings": warnings,
        "_create": create,
        "_keep": keep,
        "_deactivate": deactivate,
    }


def public_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in plan.items() if not k.startswith("_")}


def apply_layout(session: Session, spec: LayoutSpec) -> dict[str, Any]:
    plan = plan_layout(session, spec)
    if plan["blocked"]:
        raise LayoutConflict(public_plan(plan))

    used_codes = {code for (code,) in session.query(Location.code).all()}

    for loc in plan["_keep"]:
        cold = spec.is_cold(loc.aisle)
        x, y = slot_coords(spec, loc.aisle, loc.bay)
        loc.active = True
        loc.zone_type = ZoneType.COLD if cold else ZoneType.AMBIENT
        loc.capacity_units = spec.cold_slot_capacity_units if cold else spec.slot_capacity_units
        loc.max_weight_kg = spec.cold_max_weight_kg if cold else spec.max_weight_kg
        loc.x_coord, loc.y_coord = x, y

    for aisle, bay, level in plan["_create"]:
        cold = spec.is_cold(aisle)
        code = slot_code(aisle, bay, level, cold)
        suffix = 2
        while code in used_codes:
            code = f"{slot_code(aisle, bay, level, cold)}-{suffix}"
            suffix += 1
        used_codes.add(code)
        x, y = slot_coords(spec, aisle, bay)
        session.add(Location(
            code=code,
            zone_type=ZoneType.COLD if cold else ZoneType.AMBIENT,
            aisle=aisle, bay=bay, level=level,
            x_coord=x, y_coord=y,
            capacity_units=spec.cold_slot_capacity_units if cold else spec.slot_capacity_units,
            max_weight_kg=spec.cold_max_weight_kg if cold else spec.max_weight_kg,
            active=True,
        ))

    for loc in plan["_deactivate"]:
        loc.active = False

    row = session.query(WarehouseLayout).first() or WarehouseLayout()
    before = row.to_dict() if row.id else None
    for key, value in spec.to_dict().items():
        setattr(row, key, value)
    session.add(row)
    session.flush()

    s = plan["summary"]
    log_action(
        session,
        entity_type="warehouse_layout",
        action="apply",
        entity_id=row.id,
        before=before,
        after=row.to_dict(),
        notes=f"{s['total_slots']} slots: +{s['add']} added, -{s['remove']} removed",
    )
    return public_plan(plan)
