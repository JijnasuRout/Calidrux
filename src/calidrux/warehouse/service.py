"""Warehouse operations — where every unit of medicine is, and how fresh it is."""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from calidrux.config import config
from calidrux.db.models.batch import Batch, BatchStatus
from calidrux.db.models.inventory import Inventory
from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.movement import Movement, MovementLine, MovementType
from calidrux.db.models.product import Product, StorageClass
from calidrux.services.audit import log_action
from calidrux.services.inventory import (
    InventoryError,
    create_batch,
    receive_stock,
    transfer_stock,
    validate_cold_chain,
)
from calidrux.warehouse.layout import _q, get_layout

# ── Expiry buckets ────────────────────────────────────────────────────────────

BUCKETS: list[dict[str, Any]] = [
    {"key": "expired", "label": "Expired", "max_days": -1},
    {"key": "critical", "label": "≤ 30 days", "max_days": 30},
    {"key": "warning", "label": "31–90 days", "max_days": 90},
    {"key": "watch", "label": "91–180 days", "max_days": 180},
    {"key": "ok", "label": "> 180 days", "max_days": None},
]
_BUCKET_RANK = {b["key"]: i for i, b in enumerate(BUCKETS)}


def bucket_for(days_left: int, status: BatchStatus | None = None) -> str:
    if status == BatchStatus.EXPIRED or days_left < 0:
        return "expired"
    if days_left <= 30:
        return "critical"
    if days_left <= 90:
        return "warning"
    if days_left <= 180:
        return "watch"
    return "ok"


def worst_bucket(keys: list[str]) -> str | None:
    return min(keys, key=lambda k: _BUCKET_RANK[k]) if keys else None


def _num(d: Decimal | float | int) -> float:
    return round(float(d), 2)


# ── Shared loaders ────────────────────────────────────────────────────────────

def _active_locations(session: Session) -> list[Location]:
    return (
        session.query(Location)
        .filter(Location.active.is_(True))
        .order_by(Location.aisle, Location.bay, Location.level)
        .all()
    )


def _stock_rows(session: Session) -> list[Inventory]:
    return (
        session.query(Inventory)
        .options(
            joinedload(Inventory.product),
            joinedload(Inventory.batch),
            joinedload(Inventory.location),
        )
        .filter(Inventory.quantity > 0)
        .all()
    )


def _item_dict(inv: Inventory, today: date) -> dict[str, Any]:
    days_left = (inv.batch.expiry_date - today).days
    return {
        "inventory_id": inv.id,
        "product_id": inv.product_id,
        "sku": inv.product.sku,
        "name": inv.product.name,
        "storage_class": inv.product.storage_class.value,
        "batch_id": inv.batch_id,
        "lot_number": inv.batch.lot_number,
        "expiry_date": inv.batch.expiry_date.isoformat(),
        "days_left": days_left,
        "bucket": bucket_for(days_left, inv.batch.status),
        "status": inv.batch.status.value,
        "quantity": _num(inv.quantity),
        "unit_cost": _num(inv.product.unit_cost),
        "value": _num(inv.quantity * inv.product.unit_cost),
        "location_id": inv.location_id,
        "location_code": inv.location.code,
        "aisle": inv.location.aisle,
        "bay": inv.location.bay,
        "level": inv.location.level,
        "zone": inv.location.zone_type.value,
    }


# ── Floor map ─────────────────────────────────────────────────────────────────

def floor_snapshot(session: Session) -> dict[str, Any]:
    today = date.today()
    spec, inferred = get_layout(session)
    locs = _active_locations(session)
    items_by_loc: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for inv in _stock_rows(session):
        if inv.location.active:
            items_by_loc[inv.location_id].append(_item_dict(inv, today))

    racks: dict[tuple[int, int], dict[str, Any]] = {}
    for loc in locs:
        key = (loc.aisle, loc.bay)
        rack = racks.setdefault(key, {
            "aisle": loc.aisle, "bay": loc.bay, "zone": loc.zone_type.value,
            "levels": [], "quantity": 0.0, "capacity": 0, "items": 0,
            "skus": set(), "names": set(), "lots": set(), "buckets": [],
            "quarantine": False, "min_days_left": None,
        })
        items = items_by_loc.get(loc.id, [])
        qty = sum(i["quantity"] for i in items)
        level_buckets = [i["bucket"] for i in items]
        rack["levels"].append({
            "level": loc.level,
            "location_id": loc.id,
            "code": loc.code,
            "capacity": loc.capacity_units,
            "quantity": qty,
            "utilization": round(qty / loc.capacity_units, 3) if loc.capacity_units else 0,
            "bucket": worst_bucket(level_buckets),
            "items": len(items),
        })
        rack["quantity"] += qty
        rack["capacity"] += loc.capacity_units
        rack["items"] += len(items)
        rack["buckets"] += level_buckets
        if loc.zone_type == ZoneType.COLD:
            rack["zone"] = "cold"
        for i in items:
            rack["skus"].add(i["sku"])
            rack["names"].add(i["name"])
            rack["lots"].add(i["lot_number"])
            rack["quarantine"] |= i["status"] == "quarantine"
            if rack["min_days_left"] is None or i["days_left"] < rack["min_days_left"]:
                rack["min_days_left"] = i["days_left"]

    rack_list = []
    for rack in sorted(racks.values(), key=lambda r: (r["aisle"], r["bay"])):
        rack["bucket"] = worst_bucket(rack.pop("buckets"))
        rack["utilization"] = round(rack["quantity"] / rack["capacity"], 3) if rack["capacity"] else 0
        rack["quantity"] = _num(rack["quantity"])
        rack["search"] = " ".join(sorted(rack["skus"] | rack["names"] | rack["lots"])).lower()
        rack["skus"] = sorted(rack["skus"])
        rack["lots"] = sorted(rack["lots"])
        rack.pop("names")
        rack_list.append(rack)

    aisles: dict[int, dict[str, Any]] = {}
    for r in rack_list:
        a = aisles.setdefault(r["aisle"], {"aisle": r["aisle"], "zone": r["zone"], "bays": 0})
        a["bays"] = max(a["bays"], r["bay"])
        if r["zone"] != a["zone"]:
            a["zone"] = "mixed"

    all_items = [i for items in items_by_loc.values() for i in items]
    units = sum(i["quantity"] for i in all_items)
    capacity = sum(l.capacity_units for l in locs)
    cold_locs = [l for l in locs if l.zone_type == ZoneType.COLD]
    cold_units = sum(
        i["quantity"] for l in cold_locs for i in items_by_loc.get(l.id, []))
    cold_cap = sum(l.capacity_units for l in cold_locs)

    return {
        "layout": spec.to_dict(),
        "layout_inferred": inferred,
        "max_levels": max((l.level for l in locs), default=0),
        "max_bays": max((l.bay for l in locs), default=0),
        "aisles": sorted(aisles.values(), key=lambda a: a["aisle"]),
        "racks": rack_list,
        "kpis": {
            "slots": len(locs),
            "occupied_slots": sum(1 for l in locs if items_by_loc.get(l.id)),
            "units": _num(units),
            "capacity": capacity,
            "utilization": round(units / capacity, 3) if capacity else 0,
            "cold_utilization": round(cold_units / cold_cap, 3) if cold_cap else 0,
            "batches": len({i["batch_id"] for i in all_items}),
            "skus": len({i["product_id"] for i in all_items}),
            "expired_lines": sum(1 for i in all_items if i["bucket"] == "expired"),
            "critical_lines": sum(1 for i in all_items if i["bucket"] == "critical"),
            "quarantine_lines": sum(1 for i in all_items if i["status"] == "quarantine"),
            "value": _num(sum(i["value"] for i in all_items)),
        },
        "dispatch": {"x": config.settings.dispatch_x, "y": config.settings.dispatch_y},
    }


# ── Rack inspector ────────────────────────────────────────────────────────────

def _received_dates(session: Session, location_ids: list[int]) -> dict[tuple[int, int], str]:
    if not location_ids:
        return {}
    rows = (
        session.query(MovementLine.to_location_id, MovementLine.batch_id, func.max(Movement.created_at))
        .join(Movement, MovementLine.movement_id == Movement.id)
        .filter(
            MovementLine.to_location_id.in_(location_ids),
            Movement.movement_type.in_([MovementType.RECEIPT, MovementType.TRANSFER]),
        )
        .group_by(MovementLine.to_location_id, MovementLine.batch_id)
        .all()
    )
    return {(loc, batch): str(ts)[:16] for loc, batch, ts in rows if ts}


def rack_detail(session: Session, aisle: int, bay: int) -> dict[str, Any]:
    today = date.today()
    locs = (
        session.query(Location)
        .filter(Location.active.is_(True), Location.aisle == aisle, Location.bay == bay)
        .order_by(Location.level)
        .all()
    )
    if not locs:
        raise InventoryError(f"No rack at aisle {aisle}, bay {bay}")

    loc_ids = [l.id for l in locs]
    rows = (
        session.query(Inventory)
        .options(joinedload(Inventory.product), joinedload(Inventory.batch), joinedload(Inventory.location))
        .filter(Inventory.location_id.in_(loc_ids), Inventory.quantity > 0)
        .all()
    )
    received = _received_dates(session, loc_ids)
    by_loc: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for inv in rows:
        item = _item_dict(inv, today)
        item["received_at"] = received.get((inv.location_id, inv.batch_id))
        by_loc[inv.location_id].append(item)

    levels = []
    for loc in locs:
        items = sorted(by_loc.get(loc.id, []), key=lambda i: i["days_left"])
        qty = sum(i["quantity"] for i in items)
        levels.append({
            "level": loc.level,
            "location_id": loc.id,
            "code": loc.code,
            "zone": loc.zone_type.value,
            "capacity": loc.capacity_units,
            "max_weight_kg": loc.max_weight_kg,
            "quantity": _num(qty),
            "utilization": round(qty / loc.capacity_units, 3) if loc.capacity_units else 0,
            "items": items,
        })

    racks = (
        session.query(Location.aisle, Location.bay)
        .filter(Location.active.is_(True))
        .distinct()
        .order_by(Location.aisle, Location.bay)
        .all()
    )
    keys = [(a, b) for a, b in racks]
    idx = keys.index((aisle, bay))
    prev_rack = keys[idx - 1] if idx > 0 else None
    next_rack = keys[idx + 1] if idx + 1 < len(keys) else None

    qty = sum(l["quantity"] for l in levels)
    cap = sum(l["capacity"] for l in levels)
    all_items = [i for l in levels for i in l["items"]]
    return {
        "aisle": aisle,
        "bay": bay,
        "zone": "cold" if any(l.zone_type == ZoneType.COLD for l in locs) else "ambient",
        "levels": levels,
        "quantity": _num(qty),
        "capacity": cap,
        "utilization": round(qty / cap, 3) if cap else 0,
        "value": _num(sum(i["value"] for i in all_items)),
        "bucket": worst_bucket([i["bucket"] for i in all_items]),
        "prev": {"aisle": prev_rack[0], "bay": prev_rack[1]} if prev_rack else None,
        "next": {"aisle": next_rack[0], "bay": next_rack[1]} if next_rack else None,
    }


# ── Expiry board ──────────────────────────────────────────────────────────────

def expiry_board(session: Session) -> dict[str, Any]:
    today = date.today()
    items = sorted((_item_dict(inv, today) for inv in _stock_rows(session)),
                   key=lambda i: (i["days_left"], i["sku"]))
    summary = []
    for b in BUCKETS:
        rows = [i for i in items if i["bucket"] == b["key"]]
        summary.append({
            **b,
            "lines": len(rows),
            "units": _num(sum(i["quantity"] for i in rows)),
            "value": _num(sum(i["value"] for i in rows)),
        })
    return {
        "today": today.isoformat(),
        "buckets": summary,
        "items": items,
        "quarantine": {
            "lines": sum(1 for i in items if i["status"] == "quarantine"),
            "units": _num(sum(i["quantity"] for i in items if i["status"] == "quarantine")),
        },
    }


# ── Put-away ──────────────────────────────────────────────────────────────────

def _slot_contents(session: Session) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = defaultdict(lambda: {"qty": Decimal("0"), "products": set(), "lots": set()})
    rows = (
        session.query(Inventory.location_id, Inventory.product_id, Inventory.batch_id, Inventory.quantity)
        .filter(Inventory.quantity > 0)
        .all()
    )
    for loc_id, product_id, batch_id, qty in rows:
        c = out[loc_id]
        c["qty"] += qty
        c["products"].add(product_id)
        c["lots"].add(batch_id)
    return out


def suggest_putaway(
    session: Session,
    product_id: int,
    quantity: float,
    lot_number: str | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    """Rank the slots that can take this receipt.

    Rules (hard): matching temperature zone, weight limit, enough free capacity,
    and no mixing of different products in one slot (a common GDP practice to
    prevent pick errors).
    Preferences (soft): consolidate with the same lot, then the same product;
    keep fast movers close to the dock and on the lower (golden-zone) levels.
    """
    product = session.get(Product, product_id)
    if not product:
        raise InventoryError("Unknown product")
    qty = Decimal(str(quantity))
    if qty <= 0:
        raise InventoryError("Quantity must be greater than zero")

    batch = None
    if lot_number:
        batch = session.query(Batch).filter_by(product_id=product_id, lot_number=lot_number).first()

    zone = ZoneType.COLD if product.storage_class == StorageClass.COLD else ZoneType.AMBIENT
    locs = [l for l in _active_locations(session) if l.zone_type == zone]
    contents = _slot_contents(session)
    max_freq = max((p for (p,) in session.query(Product.pick_frequency_30d).all()), default=1) or 1
    velocity = product.pick_frequency_30d / max_freq
    dx, dy = config.settings.dispatch_x, config.settings.dispatch_y
    max_dist = max((l.distance_to(dx, dy) for l in locs), default=1.0) or 1.0
    max_level = max((l.level for l in locs), default=1)
    product_racks = {
        (l.aisle, l.bay) for l in locs if product_id in contents.get(l.id, {"products": set()})["products"]
    }

    candidates = []
    rejected_full = 0
    for loc in locs:
        c = contents.get(loc.id)
        used = c["qty"] if c else Decimal("0")
        others = (c["products"] - {product_id}) if c else set()
        if others:
            continue
        if float(product.weight_kg) > loc.max_weight_kg:
            continue
        free = Decimal(loc.capacity_units) - used
        if free < qty:
            rejected_full += 1
            continue

        reasons: list[str] = []
        score = (loc.distance_to(dx, dy) / max_dist) * (0.35 + 1.3 * velocity)
        score += ((loc.level - 1) / max(1, max_level - 1)) * (0.15 + 0.6 * velocity)
        if batch and c and batch.id in c["lots"]:
            score -= 1.2
            reasons.append("Consolidates with the same lot")
        elif c and product_id in c["products"]:
            score -= 0.7
            reasons.append("Same product already here")
        elif (loc.aisle, loc.bay) in product_racks:
            score -= 0.25
            reasons.append("Same rack as existing stock")
        else:
            reasons.append("Empty slot")
        if velocity >= 0.5 and loc.distance_to(dx, dy) / max_dist < 0.35:
            reasons.append("Fast mover near the dock")
        if loc.level <= 2 and velocity >= 0.3:
            reasons.append("Golden-zone level")
        reasons.append("Cold chain 2–8 °C" if zone == ZoneType.COLD else "Ambient zone")

        candidates.append({
            "location_id": loc.id,
            "code": loc.code,
            "aisle": loc.aisle,
            "bay": loc.bay,
            "level": loc.level,
            "zone": loc.zone_type.value,
            "capacity": loc.capacity_units,
            "current_qty": _num(used),
            "free": _num(free),
            "after_utilization": round(float((used + qty) / loc.capacity_units), 3),
            "distance_m": round(loc.distance_to(dx, dy), 1),
            "score": round(score, 4),
            "reasons": reasons,
        })

    candidates.sort(key=lambda c: (c["score"], c["code"]))
    message = None
    if not candidates:
        largest = max(
            (float(Decimal(l.capacity_units) - (contents[l.id]["qty"] if l.id in contents else 0))
             for l in locs), default=0)
        message = (
            f"No single {zone.value} slot can take {_q(qty)} units "
            f"(largest free space is {_q(largest)}). Split the receipt into smaller pallets."
        )
    return {
        "product": product.to_dict(),
        "zone": zone.value,
        "existing_lot": batch.to_dict() if batch else None,
        "suggestions": candidates[:limit],
        "message": message,
        "full_slots_skipped": rejected_full,
    }


def _check_slot(session: Session, location: Location, product: Product, qty: Decimal) -> None:
    if not location.active:
        raise InventoryError(f"Location {location.code} is not part of the current layout")
    validate_cold_chain(product, location)
    if float(product.weight_kg) > location.max_weight_kg:
        raise InventoryError(f"{product.sku} exceeds the weight limit of {location.code}")
    rows = (
        session.query(Inventory.product_id, Inventory.quantity)
        .filter(Inventory.location_id == location.id, Inventory.quantity > 0)
        .all()
    )
    others = {pid for pid, _ in rows if pid != product.id}
    if others:
        raise InventoryError(f"{location.code} already holds a different product — no mixing in one slot")
    used = sum((q for _, q in rows), Decimal("0"))
    if used + qty > location.capacity_units:
        raise InventoryError(
            f"{location.code} has room for {_q(Decimal(location.capacity_units) - used)} more units, "
            f"not {_q(qty)}"
        )


def receive_into_slot(
    session: Session,
    *,
    product_id: int,
    lot_number: str,
    expiry_date: date,
    quantity: float,
    location_id: int,
    reference: str | None = None,
) -> dict[str, Any]:
    product = session.get(Product, product_id)
    location = session.get(Location, location_id)
    if not product or not location:
        raise InventoryError("Unknown product or location")
    lot_number = lot_number.strip()
    if not lot_number:
        raise InventoryError("Lot number is required")
    qty = Decimal(str(quantity))
    if qty <= 0:
        raise InventoryError("Quantity must be greater than zero")

    batch = session.query(Batch).filter_by(product_id=product_id, lot_number=lot_number).first()
    created = False
    if batch:
        if batch.expiry_date != expiry_date:
            raise InventoryError(
                f"Lot {lot_number} is already on file with expiry {batch.expiry_date.isoformat()}"
            )
    else:
        if expiry_date <= date.today():
            raise InventoryError("This lot is already expired — it can't be received into stock")
        batch = create_batch(session, product_id=product_id, lot_number=lot_number, expiry_date=expiry_date)
        created = True

    _check_slot(session, location, product, qty)
    movement = receive_stock(
        session, product_id=product_id, batch_id=batch.id, location_id=location_id,
        quantity=qty, reference=reference or None,
    )
    return {
        "movement_id": movement.id,
        "batch_id": batch.id,
        "batch_created": created,
        "location_id": location.id,
        "code": location.code,
        "aisle": location.aisle,
        "bay": location.bay,
        "level": location.level,
    }


def move_stock(session: Session, *, inventory_id: int, to_location_id: int, quantity: float) -> dict[str, Any]:
    inv = session.get(Inventory, inventory_id)
    to_loc = session.get(Location, to_location_id)
    if not inv or not to_loc:
        raise InventoryError("Unknown stock line or destination")
    if inv.location_id == to_location_id:
        raise InventoryError("Stock is already in that slot")
    qty = Decimal(str(quantity))
    if qty <= 0 or qty > inv.quantity:
        raise InventoryError(f"Quantity must be between 1 and {_q(inv.quantity)}")
    _check_slot(session, to_loc, inv.product, qty)
    transfer_stock(
        session, product_id=inv.product_id, batch_id=inv.batch_id,
        from_location_id=inv.location_id, to_location_id=to_location_id, quantity=qty,
        reference="RACK-MOVE",
    )
    return {"code": to_loc.code, "aisle": to_loc.aisle, "bay": to_loc.bay, "level": to_loc.level}


def set_batch_status(session: Session, batch_id: int, status: str) -> dict[str, Any]:
    batch = session.get(Batch, batch_id)
    if not batch:
        raise InventoryError("Unknown batch")
    try:
        new_status = BatchStatus(status)
    except ValueError as exc:
        raise InventoryError(f"Unknown status {status!r}") from exc
    before = batch.to_dict()
    batch.status = new_status
    session.flush()
    log_action(session, entity_type="batch", action="status", entity_id=batch.id,
               before=before, after=batch.to_dict(), notes=f"Set to {new_status.value}")
    return batch.to_dict()


def recent_receipts(session: Session, limit: int = 8) -> list[dict[str, Any]]:
    rows = (
        session.query(MovementLine)
        .join(Movement, MovementLine.movement_id == Movement.id)
        .options(joinedload(MovementLine.product), joinedload(MovementLine.batch),
                 joinedload(MovementLine.to_location), joinedload(MovementLine.movement))
        .filter(Movement.movement_type == MovementType.RECEIPT)
        .order_by(Movement.created_at.desc(), Movement.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "sku": r.product.sku,
            "name": r.product.name,
            "lot_number": r.batch.lot_number,
            "quantity": _num(r.quantity),
            "code": r.to_location.code if r.to_location else "—",
            "aisle": r.to_location.aisle if r.to_location else None,
            "bay": r.to_location.bay if r.to_location else None,
            "reference": r.movement.reference,
            "created_at": str(r.movement.created_at)[:16],
        }
        for r in rows
    ]


# ── Demo data ─────────────────────────────────────────────────────────────────

_DEMO_OFFSETS = [-9, 21, 47, 66, 84, 110, 140, 175, 205, 240, 290, 340, 400, 460, 530, 610, 700, 760]


def populate_demo_stock(session: Session, seed: int = 7) -> dict[str, int]:
    """Fill the warehouse with realistic sample stock: several lots per product
    with spread-out expiry dates, put away using the same rules as real receipts."""
    rng = random.Random(seed)
    today = date.today()
    products = session.query(Product).order_by(Product.sku).all()
    lines = 0
    lots = 0
    for idx, product in enumerate(products):
        cold = product.storage_class == StorageClass.COLD
        n_lots = 2 + (idx % 3)
        for n in range(n_lots):
            lot = f"L{today:%y}{idx + 1:02d}{chr(65 + n)}{rng.randint(100, 999)}"
            if session.query(Batch).filter_by(product_id=product.id, lot_number=lot).first():
                continue
            offset = rng.choice(_DEMO_OFFSETS) + rng.randint(-6, 6)
            batch = create_batch(session, product_id=product.id, lot_number=lot,
                                 expiry_date=today + timedelta(days=offset))
            lots += 1
            total = Decimal(rng.randint(120, 520) if cold else rng.randint(400, 3200))
            if product.pick_frequency_30d < 30:
                total = (total / 4).quantize(Decimal("1"))
            remaining = total
            while remaining > 0:
                sug = suggest_putaway(session, product.id, 1, lot_number=lot, limit=1)["suggestions"]
                if not sug:
                    break
                take = min(remaining, Decimal(str(sug[0]["free"])))
                receive_stock(session, product_id=product.id, batch_id=batch.id,
                              location_id=sug[0]["location_id"], quantity=take, reference="DEMO")
                session.flush()
                remaining -= take
                lines += 1
    # One lot on quality hold so the quarantine state is visible.
    first = session.query(Batch).join(Inventory).filter(Inventory.quantity > 0).order_by(Batch.id).first()
    if first:
        first.status = BatchStatus.QUARANTINE
    return {"lots": lots, "lines": lines}
