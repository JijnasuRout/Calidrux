"""End-to-end tests through the HTTP API with seeded sample data."""

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


@pytest.mark.parametrize(
    "path",
    ["/", "/api/dashboard", "/api/products", "/api/locations", "/api/batches",
     "/api/inventory", "/api/movements", "/api/audit", "/api/settings",
     "/static/style.css", "/static/app.js"],
)
def test_read_endpoints(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 200


def test_seed_loaded(client: TestClient) -> None:
    assert len(client.get("/api/products").json()) > 0
    assert len(client.get("/api/locations").json()) > 0


def test_abc_run(client: TestClient) -> None:
    r = client.post("/api/abc/run", json={"threshold_a": 0.8, "threshold_b": 0.95})
    assert r.status_code == 200
    results = r.json()["results"]
    assert results, "ABC returned no results"
    # Highest-value SKU must be class A.
    assert results[0]["abc_class"] == "A"
    assert {x["abc_class"] for x in results} <= {"A", "B", "C"}


def test_slotting_run(client: TestClient) -> None:
    assert client.post("/api/slotting/run").status_code == 200
    assert client.get("/api/slotting/recommendations").status_code == 200


def test_pick_lifecycle(client: TestClient) -> None:
    inv = client.get("/api/inventory").json()
    assert inv, "seed should create inventory"
    pid = inv[0]["product_id"]
    r = client.post("/api/picks", json={"reference": "TEST-1",
                                        "lines": [{"product_id": pid, "quantity": 1}]})
    assert r.status_code == 201, r.text
    pick_id = r.json()["id"]
    detail = client.get(f"/api/picks/{pick_id}").json()
    assert detail["lines"]
    r = client.post(f"/api/picks/{pick_id}/complete", json={"duration_seconds": 60})
    assert r.status_code == 200
    assert client.get("/api/picking/metrics").status_code == 200


def test_fefo_never_picks_expired_lots(client):
    items = client.get("/api/warehouse/expiry").json()["items"]
    expired = next((i for i in items if i["days_left"] < 0 and i["status"] == "active"), None)
    if expired is None:
        pytest.skip("no expired active lot in sample data")
    r = client.post("/api/picks", json={"reference": "FEFO-T", "lines": [{"product_id": expired["product_id"], "quantity": 1}]})
    if r.status_code == 201:
        lines = client.get(f"/api/picks/{r.json()['id']}").json()["lines"]
        assert all(l["lot_number"] != expired["lot_number"] for l in lines)


def test_seed_has_pick_history(client):
    m = client.get("/api/picking/metrics").json()
    assert m["completed_picks"] >= 1
    assert m["avg_optimized_distance_m"] <= m["avg_baseline_distance_m"]
