"""Picking / TSP tests."""

from calidrux.db.models.location import Location, ZoneType
from calidrux.db.session import init_db
from calidrux.optimization.picking import solve_tsp


def test_tsp_solve():
    locs = [
        Location(code="A", zone_type=ZoneType.AMBIENT, x_coord=10, y_coord=0),
        Location(code="B", zone_type=ZoneType.AMBIENT, x_coord=20, y_coord=0),
        Location(code="C", zone_type=ZoneType.AMBIENT, x_coord=15, y_coord=10),
    ]
    result = solve_tsp(locs)
    assert len(result.ordered_location_ids) == 3
    assert result.total_distance_m >= 0
