"""Warehouse operations: floor map, racks, put-away rules, receiving, moves, layout."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from calidrux.api.app import create_app
from calidrux.db.session import _migrate, init_db
from calidrux.seed import seed_if_empty

FUTURE = (date.today() + timedelta(days=400)).isoformat()


@pytest.fixture(scope="module")
def client() -> TestClient:
    init_db()
    seed_if_empty()
    return TestClient(create_app())


def _products(client):
    return {p["sku"]: p for p in client.get("/api/products").json()}


def _cold_and_ambient(client):
    ps = list(_products(client).values())
    cold = next(p for p in ps if p["storage_class"] == "cold")
    ambient = next(p for p in ps if p["storage_class"] == "ambient")
    return cold, ambient


def test_floor_matches_layout(client):
    floor = client.get("/api/warehouse/floor").json()
    lay = floor["layout"]
    assert floor["kpis"]["slots"] == lay["aisles"] * lay["bays_per_aisle"] * lay["levels"]
    assert len(floor["racks"]) == lay["aisles"] * lay["bays_per_aisle"]
    cold_racks = {r["aisle"] for r in floor["racks"] if r["zone"] == "cold"}
    assert cold_racks == set(lay["cold_aisles"])
    assert floor["kpis"]["units"] > 0


def test_rack_detail_and_404(client):
    floor = client.get("/api/warehouse/floor").json()
    stocked = next(r for r in floor["racks"] if r["quantity"] > 0)
    rack = client.get(f"/api/warehouse/racks/{stocked['aisle']}/{stocked['bay']}").json()
    assert rack["quantity"] == pytest.approx(stocked["quantity"])
    item = next(i for lvl in rack["levels"] for i in lvl["items"])
    assert {"lot_number", "expiry_date", "days_left", "bucket", "location_code"} <= item.keys()
    assert client.get("/api/warehouse/racks/99/99").status_code == 404


def test_putaway_respects_zone_and_no_mixing(client):
    cold, ambient = _cold_and_ambient(client)
    for product, zone in ((cold, "cold"), (ambient, "ambient")):
        r = client.post("/api/warehouse/putaway/suggest",
                        json={"product_id": product["id"], "quantity": 10}).json()
        assert r["suggestions"], r
        assert all(s["zone"] == zone for s in r["suggestions"])
        assert all(s["free"] >= 10 for s in r["suggestions"])
        for s in r["suggestions"][:3]:
            rack = client.get(f"/api/warehouse/racks/{s['aisle']}/{s['bay']}").json()
            lvl = next(l for l in rack["levels"] if l["location_id"] == s["location_id"])
            assert {i["product_id"] for i in lvl["items"]} <= {product["id"]}


def test_putaway_too_big(client):
    _, ambient = _cold_and_ambient(client)
    r = client.post("/api/warehouse/putaway/suggest",
                    json={"product_id": ambient["id"], "quantity": 10_000_000}).json()
    assert r["suggestions"] == []
    assert "Split" in r["message"]


def test_receive_new_lot_then_rules(client):
    cold, ambient = _cold_and_ambient(client)
    sug = client.post("/api/warehouse/putaway/suggest",
                      json={"product_id": cold["id"], "quantity": 25}).json()["suggestions"][0]
    body = {"product_id": cold["id"], "lot_number": "TEST-COLD-1", "expiry_date": FUTURE,
            "quantity": 25, "location_id": sug["location_id"], "reference": "PO-1"}
    r = client.post("/api/warehouse/receive", json=body)
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["batch_created"] is True
    rack = client.get(f"/api/warehouse/racks/{res['aisle']}/{res['bay']}").json()
    assert any(i["lot_number"] == "TEST-COLD-1" for l in rack["levels"] for i in l["items"])

    # same lot, different expiry -> refused
    bad = dict(body, expiry_date=(date.today() + timedelta(days=500)).isoformat())
    assert client.post("/api/warehouse/receive", json=bad).status_code == 400
    # already-expired new lot -> refused
    old = dict(body, lot_number="TEST-OLD", expiry_date=(date.today() - timedelta(days=1)).isoformat())
    assert client.post("/api/warehouse/receive", json=old).status_code == 400
    # cold product into an ambient slot -> refused
    amb_slot = client.post("/api/warehouse/putaway/suggest",
                           json={"product_id": ambient["id"], "quantity": 1}).json()["suggestions"][0]
    wrong = dict(body, lot_number="TEST-COLD-2", location_id=amb_slot["location_id"])
    r = client.post("/api/warehouse/receive", json=wrong)
    assert r.status_code == 400 and "Cold-chain" in r.json()["detail"]
    # over capacity -> refused
    over = dict(body, lot_number="TEST-COLD-3", quantity=sug["capacity"] + 1)
    assert client.post("/api/warehouse/receive", json=over).status_code == 400


def test_no_mixing_products_in_a_slot(client):
    _, ambient = _cold_and_ambient(client)
    floor = client.get("/api/warehouse/floor").json()
    other_slot = None
    for r in floor["racks"]:
        if r["zone"] != "ambient" or not r["quantity"]:
            continue
        rack = client.get(f"/api/warehouse/racks/{r['aisle']}/{r['bay']}").json()
        for lvl in rack["levels"]:
            if lvl["items"] and all(i["product_id"] != ambient["id"] for i in lvl["items"]):
                other_slot = lvl
                break
        if other_slot:
            break
    assert other_slot
    r = client.post("/api/warehouse/receive", json={
        "product_id": ambient["id"], "lot_number": "TEST-MIX", "expiry_date": FUTURE,
        "quantity": 1, "location_id": other_slot["location_id"]})
    assert r.status_code == 400 and "mixing" in r.json()["detail"]


def test_move_and_hold(client):
    inv = client.get("/api/warehouse/expiry").json()["items"]
    item = next(i for i in inv if i["status"] == "active" and i["quantity"] >= 4)
    sug = client.post("/api/warehouse/putaway/suggest",
                      json={"product_id": item["product_id"], "quantity": 2}).json()["suggestions"]
    dest = next(s for s in sug if s["location_id"] != item["location_id"])
    before = sum(i["quantity"] for i in inv if i["batch_id"] == item["batch_id"])
    r = client.post("/api/warehouse/move", json={
        "inventory_id": item["inventory_id"], "to_location_id": dest["location_id"], "quantity": 2})
    assert r.status_code == 200, r.text
    after_items = client.get("/api/warehouse/expiry").json()["items"]
    after = sum(i["quantity"] for i in after_items if i["batch_id"] == item["batch_id"])
    assert after == pytest.approx(before)
    assert any(i["batch_id"] == item["batch_id"] and i["location_id"] == dest["location_id"] for i in after_items)

    # put the lot on hold -> it can't be received into any more
    assert client.post(f"/api/warehouse/batches/{item['batch_id']}/status",
                       json={"status": "quarantine"}).status_code == 200
    r = client.post("/api/warehouse/receive", json={
        "product_id": item["product_id"], "lot_number": item["lot_number"],
        "expiry_date": item["expiry_date"], "quantity": 1, "location_id": dest["location_id"]})
    assert r.status_code == 400
    client.post(f"/api/warehouse/batches/{item['batch_id']}/status", json={"status": "active"})


def test_expiry_buckets_add_up(client):
    data = client.get("/api/warehouse/expiry").json()
    assert sum(b["lines"] for b in data["buckets"]) == len(data["items"])
    days = [i["days_left"] for i in data["items"]]
    assert days == sorted(days)


def test_layout_grow_shrink_and_protect_stock(client):
    base = client.get("/api/warehouse/layout").json()["layout"]
    bigger = dict(base, aisles=base["aisles"] + 1, bays_per_aisle=base["bays_per_aisle"] + 2)
    plan = client.post("/api/warehouse/layout/preview", json=bigger).json()
    expected_add = bigger["aisles"] * bigger["bays_per_aisle"] * bigger["levels"] - plan["summary"]["keep"]
    assert plan["summary"]["add"] == expected_add and not plan["blocked"]
    assert client.put("/api/warehouse/layout", json=bigger).status_code == 200
    assert client.get("/api/warehouse/floor").json()["kpis"]["slots"] == plan["summary"]["total_slots"]

    # Shrinking below stocked racks is refused and nothing changes.
    tiny = dict(base, aisles=1, bays_per_aisle=1, levels=1, cold_aisles=[])
    r = client.put("/api/warehouse/layout", json=tiny)
    assert r.status_code == 409
    assert r.json()["detail"]["plan"]["blocked"]
    assert client.get("/api/warehouse/floor").json()["kpis"]["slots"] == plan["summary"]["total_slots"]

    # Back to the original size: the extra (empty) slots are retired.
    assert client.put("/api/warehouse/layout", json=base).status_code == 200
    floor = client.get("/api/warehouse/floor").json()
    assert floor["kpis"]["slots"] == base["aisles"] * base["bays_per_aisle"] * base["levels"]
    assert max(r["bay"] for r in floor["racks"]) == base["bays_per_aisle"]


def test_layout_validation(client):
    base = client.get("/api/warehouse/layout").json()["layout"]
    assert client.post("/api/warehouse/layout/preview", json=dict(base, aisles=0)).status_code == 422
    assert client.post("/api/warehouse/layout/preview",
                       json=dict(base, cold_aisles=[base["aisles"] + 5])).status_code == 400


def test_migration_adds_new_location_columns(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as c:
        c.exec_driver_sql("CREATE TABLE locations (id INTEGER PRIMARY KEY, code VARCHAR(32))")
        c.exec_driver_sql("INSERT INTO locations (code) VALUES ('OLD-1')")
    _migrate(eng)
    with eng.begin() as c:
        cols = {row[1] for row in c.exec_driver_sql("PRAGMA table_info(locations)")}
        row = c.exec_driver_sql("SELECT active, capacity_units FROM locations").one()
    assert {"active", "capacity_units"} <= cols
    assert tuple(row) == (1, 1000)
