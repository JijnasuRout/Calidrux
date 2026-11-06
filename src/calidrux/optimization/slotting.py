"""Slotting optimization using OR-Tools assignment."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from ortools.linear_solver import pywraplp
from sqlalchemy.orm import Session, joinedload

from calidrux.config import config
from calidrux.db.models.batch import Batch, BatchStatus
from calidrux.db.models.inventory import Inventory
from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.product import Product, StorageClass
from calidrux.db.models.slotting import SlottingRecommendation, SlottingStatus
from calidrux.optimization.abc import abc_class_map
from calidrux.services.audit import log_action


BIG_M = 1_000_000


@dataclass
class SlottingResult:
    product_id: int
    sku: str
    from_location_id: int | None
    from_code: str | None
    to_location_id: int
    to_code: str
    cost_delta: float
    reason: str


def _abc_distance_penalty(abc_class: str, loc: Location, dispatch_x: float, dispatch_y: float) -> float:
    dist = loc.distance_to(dispatch_x, dispatch_y)
    multiplier = {"A": 3.0, "B": 1.5, "C": 0.5}.get(abc_class, 1.0)
    return dist * multiplier


def _is_feasible(product: Product, loc: Location, has_quarantine: bool) -> bool:
    if has_quarantine:
        return False
    if product.storage_class == StorageClass.COLD and loc.zone_type != ZoneType.COLD:
        return False
    if product.storage_class == StorageClass.AMBIENT and loc.zone_type == ZoneType.COLD:
        return False
    if float(product.weight_kg) > loc.max_weight_kg:
        return False
    return True


def _build_cost_matrix(
    products: list[Product],
    locations: list[Location],
    current_location: dict[int, int | None],
    abc_map: dict[str, str],
    quarantine_products: set[int],
) -> list[list[float]]:
    w = config.settings.slotting
    dispatch_x = config.settings.dispatch_x
    dispatch_y = config.settings.dispatch_y
    matrix: list[list[float]] = []

    for product in products:
        row: list[float] = []
        abc = abc_map.get(product.sku, "C")
        for loc in locations:
            if not _is_feasible(product, loc, product.id in quarantine_products):
                row.append(float(BIG_M))
                continue
            cost = (
                w.abc_distance * _abc_distance_penalty(abc, loc, dispatch_x, dispatch_y)
                + w.pick_frequency * product.pick_frequency_30d * loc.distance_to(dispatch_x, dispatch_y) * 0.1
                + w.weight_level * float(product.weight_kg) * loc.level
            )
            cur = current_location.get(product.id)
            if cur == loc.id:
                cost += w.relocation * 0
            elif cur is not None:
                cost += w.relocation * 10
            else:
                cost += w.relocation * 5
            row.append(cost)
        matrix.append(row)
    return matrix


def _current_primary_location(session: Session, product_id: int) -> int | None:
    inv = (
        session.query(Inventory)
        .join(Inventory.batch)
        .filter(
            Inventory.product_id == product_id,
            Inventory.quantity > 0,
        )
        .order_by(Inventory.quantity.desc())
        .first()
    )
    return inv.location_id if inv else None


def _products_with_quarantine(session: Session) -> set[int]:
    rows = (
        session.query(Inventory.product_id)
        .join(Batch, Inventory.batch_id == Batch.id)
        .filter(Inventory.quantity > 0, Batch.status == BatchStatus.QUARANTINE)
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


def optimize_slotting(session: Session) -> tuple[str, list[SlottingResult]]:
    products = session.query(Product).order_by(Product.sku).all()
    locations = session.query(Location).order_by(Location.code).all()
    if not products or not locations:
        return str(uuid.uuid4()), []

    if len(products) > len(locations):
        products = products[: len(locations)]

    abc_map = abc_class_map(session)
    quarantine = _products_with_quarantine(session)
    current: dict[int, int | None] = {p.id: _current_primary_location(session, p.id) for p in products}

    cost_matrix = _build_cost_matrix(products, locations, current, abc_map, quarantine)

    n = len(products)
    m = len(locations)
    solver = pywraplp.Solver.CreateSolver("SCIP")
    if not solver:
        solver = pywraplp.Solver.CreateSolver("GLOP")
    if not solver:
        raise RuntimeError("No OR-Tools solver available")

    x: dict[tuple[int, int], Any] = {}
    for i in range(n):
        for j in range(m):
            x[i, j] = solver.BoolVar(f"x_{i}_{j}")

    for i in range(n):
        solver.Add(sum(x[i, j] for j in range(m)) == 1)
    for j in range(m):
        solver.Add(sum(x[i, j] for i in range(n)) <= 1)

    objective = solver.Objective()
    for i in range(n):
        for j in range(m):
            objective.SetCoefficient(x[i, j], cost_matrix[i][j])
    objective.SetMinimization()

    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        return str(uuid.uuid4()), []

    run_id = str(uuid.uuid4())
    results: list[SlottingResult] = []
    loc_by_idx = {j: locations[j] for j in range(m)}

    for i, product in enumerate(products):
        assigned_j = next(j for j in range(m) if x[i, j].solution_value() > 0.5)
        to_loc = loc_by_idx[assigned_j]
        from_id = current.get(product.id)
        if from_id == to_loc.id:
            continue
        from_code = None
        if from_id:
            from_loc = session.get(Location, from_id)
            from_code = from_loc.code if from_loc else None
        abc = abc_map.get(product.sku, "C")
        reason = (
            f"ABC class {abc}: assign {product.sku} to {to_loc.code} "
            f"(dist={to_loc.distance_to(config.settings.dispatch_x, config.settings.dispatch_y):.1f}m, "
            f"level={to_loc.level})"
        )
        cost = cost_matrix[i][assigned_j]
        results.append(
            SlottingResult(
                product_id=product.id,
                sku=product.sku,
                from_location_id=from_id,
                from_code=from_code,
                to_location_id=to_loc.id,
                to_code=to_loc.code,
                cost_delta=cost,
                reason=reason,
            )
        )

    for r in results:
        rec = SlottingRecommendation(
            product_id=r.product_id,
            from_location_id=r.from_location_id,
            to_location_id=r.to_location_id,
            cost_delta=r.cost_delta,
            reason=r.reason,
            run_id=run_id,
            status=SlottingStatus.PENDING,
        )
        session.add(rec)

    log_action(
        session,
        entity_type="slotting",
        action="optimize",
        notes=f"run_id={run_id}, recommendations={len(results)}",
    )
    return run_id, results


def list_recommendations(session: Session, status: SlottingStatus | None = None) -> list[SlottingRecommendation]:
    q = session.query(SlottingRecommendation).options(
        joinedload(SlottingRecommendation.product),
        joinedload(SlottingRecommendation.from_location),
        joinedload(SlottingRecommendation.to_location),
    )
    if status:
        q = q.filter(SlottingRecommendation.status == status)
    return q.order_by(SlottingRecommendation.created_at.desc()).all()


def accept_recommendation(session: Session, rec_id: int) -> None:
    from decimal import Decimal

    from calidrux.services.inventory import transfer_stock

    rec = session.get(SlottingRecommendation, rec_id)
    if not rec or rec.status != SlottingStatus.PENDING:
        return
    if rec.from_location_id:
        inv = (
            session.query(Inventory)
            .filter_by(product_id=rec.product_id, location_id=rec.from_location_id)
            .filter(Inventory.quantity > 0)
            .first()
        )
        if inv:
            transfer_stock(
                session,
                product_id=rec.product_id,
                batch_id=inv.batch_id,
                from_location_id=rec.from_location_id,
                to_location_id=rec.to_location_id,
                quantity=inv.quantity,
                reference=f"slotting-{rec.run_id}",
            )
    rec.status = SlottingStatus.ACCEPTED
    log_action(session, entity_type="slotting", action="accept", entity_id=rec.id)


def reject_recommendation(session: Session, rec_id: int) -> None:
    rec = session.get(SlottingRecommendation, rec_id)
    if rec and rec.status == SlottingStatus.PENDING:
        rec.status = SlottingStatus.REJECTED
        log_action(session, entity_type="slotting", action="reject", entity_id=rec.id)
