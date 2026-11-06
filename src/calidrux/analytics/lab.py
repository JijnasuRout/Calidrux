"""Optimization Lab — what-if analysis on the live warehouse, without changing it.

* Route simulator: Monte Carlo pick orders, OR-Tools TSP vs the aisle-by-aisle baseline.
* Slotting what-if: re-run the assignment model with different weights inside a
  rolled-back savepoint and measure picker travel before/after, plus a trade-off
  sweep over the relocation weight.
"""

from __future__ import annotations

import random
import statistics
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from calidrux.config import config
from calidrux.db.models.batch import Batch, BatchStatus
from calidrux.db.models.inventory import Inventory
from calidrux.db.models.location import Location
from calidrux.db.models.product import Product
from calidrux.db.session import SessionLocal, get_session
from calidrux.optimization.abc import compute_abc
from calidrux.optimization.picking import solve_tsp
from calidrux.optimization.slotting import _current_primary_location, optimize_slotting

# ── Route simulator ───────────────────────────────────────────────────────────

def _pickable_slots(session: Session) -> list[tuple[Location, float]]:
    """Slots holding shippable stock, weighted by how often their product is picked."""
    rows = (
        session.query(Inventory, Product.pick_frequency_30d)
        .join(Product, Inventory.product_id == Product.id)
        .join(Batch, Inventory.batch_id == Batch.id)
        .join(Location, Inventory.location_id == Location.id)
        .filter(Inventory.quantity > 0, Batch.status == BatchStatus.ACTIVE,
                Batch.expiry_date >= date.today(), Location.active.is_(True))
        .all()
    )
    weights: dict[int, float] = {}
    locs: dict[int, Location] = {}
    for inv, freq in rows:
        locs[inv.location_id] = inv.location
        weights[inv.location_id] = weights.get(inv.location_id, 0) + max(1, freq)
    return [(locs[k], w) for k, w in weights.items()]


def _weighted_sample(rng: random.Random, items: list[tuple[Location, float]], k: int) -> list[Location]:
    pool = list(items)
    out: list[Location] = []
    for _ in range(min(k, len(pool))):
        total = sum(w for _, w in pool)
        r = rng.uniform(0, total)
        acc = 0.0
        for i, (loc, w) in enumerate(pool):
            acc += w
            if acc >= r:
                out.append(loc)
                pool.pop(i)
                break
    return out


def simulate_routes(session: Session, orders: int, lines: int, seed: int | None = None) -> dict[str, Any]:
    slots = _pickable_slots(session)
    if len(slots) < 2:
        raise ValueError("Not enough stocked slots to simulate orders")
    rng = random.Random(seed)
    results = []
    for _ in range(orders):
        stops = _weighted_sample(rng, slots, lines)
        r = solve_tsp(stops, improve=False)
        saving = (1 - r.total_distance_m / r.baseline_distance_m) * 100 if r.baseline_distance_m else 0.0
        results.append({
            "stops": len(stops),
            "optimized_m": round(r.total_distance_m, 1),
            "baseline_m": round(r.baseline_distance_m, 1),
            "savings_pct": round(max(0.0, saving), 2),
        })
    savings = sorted(x["savings_pct"] for x in results)
    q = lambda p: savings[min(len(savings) - 1, int(p * len(savings)))]  # noqa: E731
    opt = statistics.fmean(x["optimized_m"] for x in results)
    base = statistics.fmean(x["baseline_m"] for x in results)
    return {
        "orders": results,
        "summary": {
            "orders": len(results),
            "lines": lines,
            "avg_optimized_m": round(opt, 1),
            "avg_baseline_m": round(base, 1),
            "avg_saved_m": round(base - opt, 1),
            "mean_savings_pct": round((1 - opt / base) * 100, 1) if base else 0,
            "median_savings_pct": round(statistics.median(savings), 1),
            "p10_savings_pct": round(q(0.10), 1),
            "p90_savings_pct": round(q(0.90), 1),
        },
    }


# ── Slotting what-if ─────────────────────────────────────────────────────────

WEIGHT_KEYS = ("abc_distance", "pick_frequency", "weight_level", "relocation")


def _travel(products: list[Product], placement: dict[int, Location | None], dx: float, dy: float) -> float:
    """Expected picker travel per 30 days: picks x round trip to the dock (metres)."""
    return sum(p.pick_frequency_30d * 2 * placement[p.id].distance_to(dx, dy)
               for p in products if placement.get(p.id) is not None)


def slotting_what_if(weights: dict[str, float]) -> dict[str, Any]:
    session = SessionLocal()
    saved = config.settings.slotting.model_copy()
    try:
        for k in WEIGHT_KEYS:
            if k in weights:
                setattr(config.settings.slotting, k, float(weights[k]))
        dx, dy = config.settings.dispatch_x, config.settings.dispatch_y
        products = session.query(Product).all()
        locs = {l.id: l for l in session.query(Location).all()}
        before = {p.id: locs.get(_current_primary_location(session, p.id)) for p in products}
        abc = {r.sku: r.abc_class for r in compute_abc(session)}

        nested = session.begin_nested()
        _, results = optimize_slotting(session)
        nested.rollback()

        after = dict(before)
        for r in results:
            after[r.product_id] = locs[r.to_location_id]
        t0, t1 = _travel(products, before, dx, dy), _travel(products, after, dx, dy)

        by_class: dict[str, dict[str, float]] = {}
        for cls in ("A", "B", "C"):
            ps = [p for p in products if abc.get(p.sku, "C") == cls and before.get(p.id)]
            if ps:
                by_class[cls] = {
                    "skus": len(ps),
                    "before_m": round(statistics.fmean(before[p.id].distance_to(dx, dy) for p in ps), 1),
                    "after_m": round(statistics.fmean(after[p.id].distance_to(dx, dy) for p in ps), 1),
                }
        return {
            "weights": {k: getattr(config.settings.slotting, k) for k in WEIGHT_KEYS},
            "moves": len(results),
            "travel_before_km": round(t0 / 1000, 2),
            "travel_after_km": round(t1 / 1000, 2),
            "reduction_pct": round((1 - t1 / t0) * 100, 1) if t0 else 0.0,
            "by_class": by_class,
            "move_list": [{"sku": r.sku, "from": r.from_code, "to": r.to_code} for r in results[:40]],
        }
    finally:
        config.settings.slotting = saved
        session.rollback()
        session.close()


def slotting_sweep(weights: dict[str, float], values: list[float]) -> list[dict[str, Any]]:
    out = []
    for v in values:
        r = slotting_what_if({**weights, "relocation": v})
        out.append({"relocation": v, "moves": r["moves"], "reduction_pct": r["reduction_pct"],
                    "travel_after_km": r["travel_after_km"]})
    return out


# ── API ──────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/lab", tags=["lab"])


class RouteSimBody(BaseModel):
    orders: int = Field(100, ge=1, le=500)
    lines: int = Field(8, ge=1, le=40)
    seed: int | None = None


class Weights(BaseModel):
    abc_distance: float = Field(1.0, ge=0, le=10)
    pick_frequency: float = Field(0.5, ge=0, le=10)
    weight_level: float = Field(0.3, ge=0, le=10)
    relocation: float = Field(0.2, ge=0, le=10)


class SweepBody(Weights):
    values: list[float] = Field(default_factory=lambda: [0, 0.2, 0.5, 1, 2, 5], max_length=10)


@router.post("/routes")
def lab_routes(body: RouteSimBody):
    try:
        with get_session() as s:
            return simulate_routes(s, body.orders, body.lines, body.seed)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/slotting")
def lab_slotting(body: Weights):
    return slotting_what_if(body.model_dump())


@router.post("/slotting/sweep")
def lab_slotting_sweep(body: SweepBody):
    return slotting_sweep(body.model_dump(exclude={"values"}), body.values)
