"""Optimization Lab: simulations and what-ifs must be correct and must never change data."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from calidrux.api.app import create_app
from calidrux.db.session import init_db
from calidrux.seed import seed_if_empty


@pytest.fixture(scope="module")
def client() -> TestClient:
    init_db()
    seed_if_empty()
    return TestClient(create_app())


def _counts(client):
    return (len(client.get("/api/slotting/recommendations").json()),
            len(client.get("/api/audit?limit=5000").json()),
            client.get("/api/warehouse/floor").json()["kpis"]["units"])


def test_route_simulation(client):
    r = client.post("/api/lab/routes", json={"orders": 40, "lines": 8, "seed": 3})
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["orders"]) == 40
    assert all(o["optimized_m"] <= o["baseline_m"] + 1e-6 for o in d["orders"])
    s = d["summary"]
    assert s["p10_savings_pct"] <= s["median_savings_pct"] <= s["p90_savings_pct"]
    assert s["avg_saved_m"] == pytest.approx(s["avg_baseline_m"] - s["avg_optimized_m"], abs=0.11)
    # Same seed, same answer.
    again = client.post("/api/lab/routes", json={"orders": 40, "lines": 8, "seed": 3}).json()
    assert again["summary"] == s


def test_route_simulation_validation(client):
    assert client.post("/api/lab/routes", json={"orders": 0, "lines": 5}).status_code == 422
    assert client.post("/api/lab/routes", json={"orders": 5, "lines": 99}).status_code == 422


def test_slotting_what_if_changes_nothing(client):
    before = _counts(client)
    r = client.post("/api/lab/slotting", json={"abc_distance": 2, "pick_frequency": 1, "weight_level": 0.3, "relocation": 0.1})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["travel_after_km"] <= d["travel_before_km"] + 1e-6
    assert d["moves"] == len(d["move_list"]) or len(d["move_list"]) == 40
    assert _counts(client) == before
    # Settings are restored after a what-if.
    s = client.get("/api/settings").json()
    assert s["slotting_w_abc"] == 1.0 and s["slotting_w_relocation"] == 0.2


def test_higher_relocation_cost_means_fewer_moves(client):
    sweep = client.post("/api/lab/slotting/sweep", json={"values": [0, 10]}).json()
    assert sweep[0]["relocation"] == 0 and sweep[1]["relocation"] == 10
    assert sweep[1]["moves"] <= sweep[0]["moves"]
