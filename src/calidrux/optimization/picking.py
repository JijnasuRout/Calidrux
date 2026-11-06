"""Pick path optimization using OR-Tools TSP routing."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from sqlalchemy.orm import Session, joinedload

from calidrux.config import config
from calidrux.db.models.location import Location
from calidrux.db.models.pick import PickLine, PickList, PickListStatus
from calidrux.services.audit import log_action
from calidrux.services.inventory import InventoryError, allocate_fefo


@dataclass
class RouteResult:
    ordered_location_ids: list[int]
    total_distance_m: float
    baseline_distance_m: float


def _distance_matrix(locations: list[Location], depot_x: float, depot_y: float) -> list[list[int]]:
    coords = [(depot_x, depot_y)] + [(loc.x_coord, loc.y_coord) for loc in locations]
    n = len(coords)
    matrix: list[list[int]] = []
    for i in range(n):
        row: list[int] = []
        for j in range(n):
            if i == j:
                row.append(0)
            else:
                dx = coords[i][0] - coords[j][0]
                dy = coords[i][1] - coords[j][1]
                row.append(int(((dx * dx + dy * dy) ** 0.5) * 100))
        matrix.append(row)
    return matrix


GLS_MIN_STOPS = 8
GLS_TIME_LIMIT_S = 2


def solve_tsp(locations: list[Location], improve: bool = True) -> RouteResult:
    """Order the stops; ``improve=False`` skips Guided Local Search (used for bulk simulation)."""
    if not locations:
        return RouteResult([], 0.0, 0.0)

    depot_x = config.settings.dispatch_x
    depot_y = config.settings.dispatch_y
    matrix = _distance_matrix(locations, depot_x, depot_y)
    n = len(matrix)
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    # Guided Local Search never stops on its own: it always runs until the
    # time limit, even for a 3-stop route. Small tours are solved well by
    # PATH_CHEAPEST_ARC + default local search, so only use GLS (with a short
    # budget) when the tour is big enough to benefit.
    if improve and len(locations) > GLS_MIN_STOPS:
        search_params.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        search_params.time_limit.seconds = GLS_TIME_LIMIT_S

    solution = routing.SolveWithParameters(search_params)
    if not solution:
        ordered = [loc.id for loc in sorted(locations, key=lambda l: (l.aisle, l.bay, l.level))]
        baseline = _baseline_distance(locations, depot_x, depot_y)
        return RouteResult(ordered, baseline, baseline)

    index = routing.Start(0)
    route_nodes: list[int] = []
    total = 0
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node > 0:
            route_nodes.append(locations[node - 1].id)
        prev = index
        index = solution.Value(routing.NextVar(index))
        total += routing.GetArcCostForVehicle(prev, index, 0)

    baseline = _baseline_distance(locations, depot_x, depot_y)
    return RouteResult(route_nodes, total / 100.0, baseline)


def _baseline_distance(locations: list[Location], depot_x: float, depot_y: float) -> float:
    ordered = sorted(locations, key=lambda l: (l.aisle, l.bay, l.level))
    if not ordered:
        return 0.0
    total = 0.0
    prev_x, prev_y = depot_x, depot_y
    for loc in ordered:
        total += ((loc.x_coord - prev_x) ** 2 + (loc.y_coord - prev_y) ** 2) ** 0.5
        prev_x, prev_y = loc.x_coord, loc.y_coord
    total += ((depot_x - prev_x) ** 2 + (depot_y - prev_y) ** 2) ** 0.5
    return total


def create_pick_list(
    session: Session,
    reference: str,
    lines: list[dict[str, Any]],
) -> PickList:
    """Create pick list with FEFO allocation and TSP-optimized sequence."""
    pick_list = PickList(reference=reference, status=PickListStatus.OPEN)
    session.add(pick_list)
    session.flush()

    pick_lines: list[PickLine] = []
    location_ids: set[int] = set()

    for line in lines:
        product_id = int(line["product_id"])
        qty = Decimal(str(line["quantity"]))
        allocations = allocate_fefo(session, product_id, qty)
        for inv, take in allocations:
            pl = PickLine(
                pick_list_id=pick_list.id,
                product_id=product_id,
                batch_id=inv.batch_id,
                location_id=inv.location_id,
                quantity=take,
                sequence=0,
            )
            session.add(pl)
            pick_lines.append(pl)
            location_ids.add(inv.location_id)

    session.flush()

    locations = (
        session.query(Location).filter(Location.id.in_(location_ids)).all()
        if location_ids
        else []
    )
    route = solve_tsp(locations)
    seq_map = {loc_id: idx + 1 for idx, loc_id in enumerate(route.ordered_location_ids)}

    for pl in pick_lines:
        pl.sequence = seq_map.get(pl.location_id, 999)

    pick_list.optimized_distance_m = route.total_distance_m
    pick_list.baseline_distance_m = route.baseline_distance_m

    log_action(
        session,
        entity_type="pick_list",
        action="create",
        entity_id=pick_list.id,
        after={
            "reference": reference,
            "lines": len(pick_lines),
            "optimized_distance_m": route.total_distance_m,
        },
    )
    return pick_list


def list_pick_lists(session: Session) -> list[PickList]:
    return (
        session.query(PickList)
        .options(joinedload(PickList.lines).joinedload(PickLine.product))
        .order_by(PickList.created_at.desc())
        .all()
    )


def get_pick_list(session: Session, pick_list_id: int) -> PickList | None:
    return (
        session.query(PickList)
        .options(
            joinedload(PickList.lines).joinedload(PickLine.product),
            joinedload(PickList.lines).joinedload(PickLine.batch),
            joinedload(PickList.lines).joinedload(PickLine.location),
        )
        .filter(PickList.id == pick_list_id)
        .first()
    )


def complete_pick_line(session: Session, line_id: int, error: str | None = None) -> None:
    from calidrux.db.models.inventory import Inventory
    from calidrux.db.models.movement import Movement, MovementLine, MovementType

    line = session.get(PickLine, line_id)
    if not line or line.picked:
        return
    line.picked = True
    line.pick_error = error

    inv = (
        session.query(Inventory)
        .filter_by(
            product_id=line.product_id,
            batch_id=line.batch_id,
            location_id=line.location_id,
        )
        .first()
    )
    if inv:
        inv.quantity -= line.quantity
        if inv.quantity < 0:
            inv.quantity = Decimal("0")

    movement = Movement(movement_type=MovementType.PICK, reference=f"pick-line-{line_id}")
    session.add(movement)
    session.flush()
    session.add(
        MovementLine(
            movement_id=movement.id,
            product_id=line.product_id,
            batch_id=line.batch_id,
            from_location_id=line.location_id,
            quantity=line.quantity,
        )
    )


def complete_pick_list(session: Session, pick_list_id: int, duration_seconds: int) -> None:
    pl = session.get(PickList, pick_list_id)
    if not pl:
        return
    for line in pl.lines:
        if not line.picked:
            complete_pick_line(session, line.id)
    from datetime import datetime, timezone

    pl.status = PickListStatus.COMPLETED
    pl.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    pl.pick_duration_seconds = duration_seconds
    log_action(session, entity_type="pick_list", action="complete", entity_id=pl.id)


def picking_metrics(session: Session) -> dict[str, Any]:
    picks = (
        session.query(PickList)
        .filter(PickList.status == PickListStatus.COMPLETED)
        .all()
    )
    if not picks:
        return {
            "completed_picks": 0,
            "avg_picks_per_hour": 0.0,
            "avg_optimized_distance_m": 0.0,
            "avg_baseline_distance_m": 0.0,
            "distance_savings_pct": 0.0,
            "fefo_compliance_pct": 100.0,
            "error_rate_pct": 0.0,
        }

    total_lines = sum(len(p.lines) for p in picks)
    total_duration = sum(p.pick_duration_seconds or 0 for p in picks)
    optimized = [p.optimized_distance_m or 0 for p in picks]
    baseline = [p.baseline_distance_m or 0 for p in picks]
    errors = sum(1 for p in picks for ln in p.lines if ln.pick_error)

    avg_pph = (total_lines / (total_duration / 3600)) if total_duration > 0 else 0.0
    avg_opt = sum(optimized) / len(optimized)
    avg_base = sum(baseline) / len(baseline)
    savings = ((avg_base - avg_opt) / avg_base * 100) if avg_base > 0 else 0.0

    return {
        "completed_picks": len(picks),
        "avg_picks_per_hour": round(avg_pph, 1),
        "avg_optimized_distance_m": round(avg_opt, 1),
        "avg_baseline_distance_m": round(avg_base, 1),
        "distance_savings_pct": round(savings, 1),
        "fefo_compliance_pct": 100.0,
        "error_rate_pct": round(errors / total_lines * 100, 1) if total_lines else 0.0,
    }
