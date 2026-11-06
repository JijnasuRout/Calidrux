"""FastAPI application — all REST routes for Calidrux."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from calidrux.config import config
from calidrux.db.models.batch import BatchStatus
from calidrux.db.models.slotting import SlottingStatus
from calidrux.db.session import get_session
from calidrux.optimization.abc import compute_abc, list_snapshots, pareto_data, save_snapshot
from calidrux.optimization.picking import (
    complete_pick_list,
    create_pick_list,
    get_pick_list,
    list_pick_lists,
    picking_metrics,
)
from calidrux.optimization.slotting import (
    accept_recommendation,
    list_recommendations,
    optimize_slotting,
    reject_recommendation,
)
from calidrux.services.audit import list_audit_logs
from calidrux.services.inventory import (
    InventoryError,
    adjust_stock,
    create_batch,
    create_location,
    create_product,
    get_dashboard_kpis,
    get_expiry_alerts,
    import_locations_csv,
    import_products_csv,
    list_batches,
    list_inventory,
    list_locations,
    list_movements,
    list_products,
    receive_stock,
    transfer_stock,
    update_location,
    update_product,
)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    sku: str
    name: str
    storage_class: str = "ambient"
    unit_cost: float = 0.0
    weight_kg: float = 0.0
    pick_frequency_30d: int = 0


class LocationCreate(BaseModel):
    code: str
    zone_type: str = "ambient"
    aisle: int = 0
    bay: int = 0
    level: int = 0
    x_coord: float = 0.0
    y_coord: float = 0.0
    max_weight_kg: int = 500


class BatchCreate(BaseModel):
    product_id: int
    lot_number: str
    expiry_date: str


class ReceiveRequest(BaseModel):
    product_id: int
    batch_id: int
    location_id: int
    quantity: float
    reference: Optional[str] = None


class TransferRequest(BaseModel):
    product_id: int
    batch_id: int
    from_location_id: int
    to_location_id: int
    quantity: float
    reference: Optional[str] = None


class AdjustRequest(BaseModel):
    product_id: int
    batch_id: int
    location_id: int
    new_quantity: float
    reason: str


class AbcRunRequest(BaseModel):
    threshold_a: float = 0.80
    threshold_b: float = 0.95


class SnapshotRequest(BaseModel):
    label: str


class PickCreateRequest(BaseModel):
    reference: str
    lines: List[dict]


class CompletePickRequest(BaseModel):
    duration_seconds: int = 0


class SettingsUpdate(BaseModel):
    user_name: str = "operator"
    dispatch_x: float = 0.0
    dispatch_y: float = 0.0
    abc_threshold_a: float = 0.80
    abc_threshold_b: float = 0.95
    slotting_w_abc: float = 1.0
    slotting_w_pick: float = 0.5
    slotting_w_weight: float = 0.3
    slotting_w_relocation: float = 0.2
    expiry_alert_days: List[int] = [30, 60, 90]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _static_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "static"
    return Path(__file__).parent / "static"


def _err(msg: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=str(msg))


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(title="Calidrux", docs_url=None, redoc_url=None)
    static = _static_dir()
    if static.exists():
        app.mount("/static", StaticFiles(directory=str(static)), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index():
        return FileResponse(str(static / "index.html"))

    # ── Dashboard ──────────────────────────────────────────────────────────

    @app.get("/api/dashboard")
    def dashboard():
        with get_session() as s:
            return {"kpis": get_dashboard_kpis(s), "alerts": get_expiry_alerts(s)}

    # ── Products ───────────────────────────────────────────────────────────

    @app.get("/api/products")
    def products_list():
        with get_session() as s:
            return [p.to_dict() for p in list_products(s)]

    @app.post("/api/products", status_code=201)
    def products_create(body: ProductCreate):
        from calidrux.db.models.product import StorageClass
        try:
            with get_session() as s:
                p = create_product(
                    s,
                    sku=body.sku,
                    name=body.name,
                    storage_class=StorageClass(body.storage_class),
                    unit_cost=Decimal(str(body.unit_cost)),
                    weight_kg=Decimal(str(body.weight_kg)),
                    pick_frequency_30d=body.pick_frequency_30d,
                )
                return p.to_dict()
        except Exception as e:
            raise _err(e)

    @app.patch("/api/products/{pid}")
    def products_update(pid: int, body: ProductCreate):
        from calidrux.db.models.product import Product, StorageClass
        with get_session() as s:
            p = s.get(Product, pid)
            if not p:
                raise _err("Not found", 404)
            update_product(
                s, p,
                name=body.name,
                storage_class=StorageClass(body.storage_class),
                unit_cost=Decimal(str(body.unit_cost)),
                weight_kg=Decimal(str(body.weight_kg)),
                pick_frequency_30d=body.pick_frequency_30d,
            )
            return p.to_dict()

    # ── Locations ──────────────────────────────────────────────────────────

    @app.get("/api/locations")
    def locations_list():
        with get_session() as s:
            return [l.to_dict() for l in list_locations(s)]

    @app.post("/api/locations", status_code=201)
    def locations_create(body: LocationCreate):
        from calidrux.db.models.location import ZoneType
        try:
            with get_session() as s:
                loc = create_location(
                    s,
                    code=body.code,
                    zone_type=ZoneType(body.zone_type),
                    aisle=body.aisle,
                    bay=body.bay,
                    level=body.level,
                    x_coord=body.x_coord,
                    y_coord=body.y_coord,
                    max_weight_kg=body.max_weight_kg,
                )
                return loc.to_dict()
        except Exception as e:
            raise _err(e)

    # ── Batches ────────────────────────────────────────────────────────────

    @app.get("/api/batches")
    def batches_list(product_id: Optional[int] = None):
        with get_session() as s:
            return [b.to_dict() for b in list_batches(s, product_id=product_id)]

    @app.post("/api/batches", status_code=201)
    def batches_create(body: BatchCreate):
        try:
            with get_session() as s:
                b = create_batch(
                    s,
                    product_id=body.product_id,
                    lot_number=body.lot_number,
                    expiry_date=date.fromisoformat(body.expiry_date),
                )
                return b.to_dict()
        except Exception as e:
            raise _err(e)

    # ── Inventory ──────────────────────────────────────────────────────────

    @app.get("/api/inventory")
    def inventory_list():
        with get_session() as s:
            return [
                {
                    "id": i.id,
                    "product_id": i.product_id,
                    "sku": i.product.sku,
                    "product_name": i.product.name,
                    "lot_number": i.batch.lot_number,
                    "expiry_date": i.batch.expiry_date.isoformat(),
                    "batch_status": i.batch.status.value,
                    "location_id": i.location_id,
                    "location_code": i.location.code,
                    "zone_type": i.location.zone_type.value,
                    "quantity": float(i.quantity),
                }
                for i in list_inventory(s)
            ]

    @app.post("/api/inventory/receive")
    def inventory_receive(body: ReceiveRequest):
        try:
            with get_session() as s:
                m = receive_stock(
                    s,
                    product_id=body.product_id,
                    batch_id=body.batch_id,
                    location_id=body.location_id,
                    quantity=Decimal(str(body.quantity)),
                    reference=body.reference,
                )
                return {"movement_id": m.id}
        except InventoryError as e:
            raise _err(e)

    @app.post("/api/inventory/transfer")
    def inventory_transfer(body: TransferRequest):
        try:
            with get_session() as s:
                m = transfer_stock(
                    s,
                    product_id=body.product_id,
                    batch_id=body.batch_id,
                    from_location_id=body.from_location_id,
                    to_location_id=body.to_location_id,
                    quantity=Decimal(str(body.quantity)),
                    reference=body.reference,
                )
                return {"movement_id": m.id}
        except InventoryError as e:
            raise _err(e)

    @app.post("/api/inventory/adjust")
    def inventory_adjust(body: AdjustRequest):
        try:
            with get_session() as s:
                m = adjust_stock(
                    s,
                    product_id=body.product_id,
                    batch_id=body.batch_id,
                    location_id=body.location_id,
                    new_quantity=Decimal(str(body.new_quantity)),
                    reason=body.reason,
                )
                return {"movement_id": m.id}
        except InventoryError as e:
            raise _err(e)

    @app.get("/api/movements")
    def movements_list():
        with get_session() as s:
            return [
                {
                    "id": m.id,
                    "type": m.movement_type.value,
                    "reference": m.reference,
                    "reason": m.reason,
                    "user": m.user_name,
                    "created_at": str(m.created_at)[:19],
                    "lines": len(m.lines),
                }
                for m in list_movements(s)
            ]

    # ── CSV Import ─────────────────────────────────────────────────────────

    @app.post("/api/import/products")
    def import_products_route(file: UploadFile = File(...)):
        content = file.file.read()
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            with get_session() as s:
                n = import_products_csv(s, tmp_path)
            return {"imported": n}
        finally:
            os.unlink(tmp_path)

    @app.post("/api/import/locations")
    def import_locations_route(file: UploadFile = File(...)):
        content = file.file.read()
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            with get_session() as s:
                n = import_locations_csv(s, tmp_path)
            return {"imported": n}
        finally:
            os.unlink(tmp_path)

    # ── ABC Analysis ───────────────────────────────────────────────────────

    @app.post("/api/abc/run")
    def abc_run(body: AbcRunRequest):
        with get_session() as s:
            results = compute_abc(s, body.threshold_a, body.threshold_b)
        df = pareto_data(results)
        pareto = {
            "labels": df["sku"].tolist() if not df.empty else [],
            "auv": [round(v, 2) for v in df["auv"].tolist()] if not df.empty else [],
            "cumulative": [round(v * 100, 1) for v in df["cum_pct"].tolist()] if not df.empty else [],
            "abc_class": df["abc_class"].tolist() if not df.empty else [],
        }
        return {
            "results": [
                {
                    "sku": r.sku,
                    "name": r.name,
                    "pick_frequency": r.pick_frequency,
                    "unit_cost": round(r.unit_cost, 2),
                    "auv": round(r.auv, 2),
                    "cum_pct": round(r.cum_pct * 100, 1),
                    "abc_class": r.abc_class,
                    "recommended_zone": r.recommended_zone,
                }
                for r in results
            ],
            "pareto": pareto,
        }

    @app.post("/api/abc/snapshot")
    def abc_snapshot(body: SnapshotRequest):
        with get_session() as s:
            results = compute_abc(s)
            snap = save_snapshot(s, results, body.label)
        return {"id": snap.id, "label": snap.label, "created_at": str(snap.created_at)[:19]}

    @app.get("/api/abc/snapshots")
    def abc_snapshots_list():
        with get_session() as s:
            return [
                {"id": s.id, "label": s.label, "created_at": str(s.created_at)[:19], "count": len(s.results)}
                for s in list_snapshots(s)
            ]

    # ── Slotting ───────────────────────────────────────────────────────────

    @app.post("/api/slotting/run")
    def slotting_run():
        try:
            with get_session() as s:
                run_id, results = optimize_slotting(s)
            return {
                "run_id": run_id,
                "count": len(results),
                "results": [
                    {
                        "sku": r.sku,
                        "from_code": r.from_code,
                        "to_code": r.to_code,
                        "cost_delta": round(r.cost_delta, 2),
                        "reason": r.reason,
                    }
                    for r in results
                ],
            }
        except Exception as e:
            raise _err(e, 500)

    @app.get("/api/slotting/recommendations")
    def slotting_recs(status: Optional[str] = None):
        with get_session() as s:
            st = SlottingStatus(status) if status else None
            recs = list_recommendations(s, st)
            return [
                {
                    "id": r.id,
                    "sku": r.product.sku,
                    "from_code": r.from_location.code if r.from_location else "—",
                    "to_code": r.to_location.code,
                    "cost_delta": round(r.cost_delta, 2),
                    "reason": r.reason,
                    "status": r.status.value,
                    "created_at": str(r.created_at)[:19],
                }
                for r in recs
            ]

    @app.post("/api/slotting/{rec_id}/accept")
    def slotting_accept(rec_id: int):
        try:
            with get_session() as s:
                accept_recommendation(s, rec_id)
            return {"ok": True}
        except Exception as e:
            raise _err(e)

    @app.post("/api/slotting/{rec_id}/reject")
    def slotting_reject(rec_id: int):
        with get_session() as s:
            reject_recommendation(s, rec_id)
        return {"ok": True}

    # ── Picking ────────────────────────────────────────────────────────────

    @app.get("/api/picks")
    def picks_list():
        with get_session() as s:
            return [
                {
                    "id": p.id,
                    "reference": p.reference,
                    "status": p.status.value,
                    "lines": len(p.lines),
                    "optimized_distance_m": round(p.optimized_distance_m or 0, 1),
                    "baseline_distance_m": round(p.baseline_distance_m or 0, 1),
                    "created_at": str(p.created_at)[:19],
                }
                for p in list_pick_lists(s)
            ]

    @app.post("/api/picks", status_code=201)
    def picks_create(body: PickCreateRequest):
        try:
            with get_session() as s:
                pl = create_pick_list(s, body.reference, body.lines)
                return {
                    "id": pl.id,
                    "reference": pl.reference,
                    "lines": len(pl.lines),
                    "optimized_distance_m": round(pl.optimized_distance_m or 0, 1),
                    "baseline_distance_m": round(pl.baseline_distance_m or 0, 1),
                }
        except Exception as e:
            raise _err(e)

    @app.get("/api/picks/{pick_id}")
    def picks_get(pick_id: int):
        with get_session() as s:
            pl = get_pick_list(s, pick_id)
            if not pl:
                raise _err("Not found", 404)
            return {
                "id": pl.id,
                "reference": pl.reference,
                "status": pl.status.value,
                "optimized_distance_m": round(pl.optimized_distance_m or 0, 1),
                "baseline_distance_m": round(pl.baseline_distance_m or 0, 1),
                "lines": [
                    {
                        "id": ln.id,
                        "sequence": ln.sequence,
                        "sku": ln.product.sku,
                        "lot_number": ln.batch.lot_number,
                        "expiry_date": ln.batch.expiry_date.isoformat(),
                        "location_code": ln.location.code,
                        "quantity": float(ln.quantity),
                        "picked": ln.picked,
                        "pick_error": ln.pick_error,
                    }
                    for ln in sorted(pl.lines, key=lambda l: l.sequence)
                ],
            }

    @app.post("/api/picks/{pick_id}/complete")
    def picks_complete(pick_id: int, body: CompletePickRequest):
        with get_session() as s:
            complete_pick_list(s, pick_id, body.duration_seconds)
        return {"ok": True}

    @app.get("/api/picking/metrics")
    def picking_metrics_route():
        with get_session() as s:
            return picking_metrics(s)

    # ── Audit ──────────────────────────────────────────────────────────────

    @app.get("/api/audit")
    def audit_list(limit: int = 300):
        with get_session() as s:
            return [
                {
                    "id": lg.id,
                    "entity_type": lg.entity_type,
                    "entity_id": lg.entity_id,
                    "action": lg.action,
                    "user_name": lg.user_name,
                    "notes": lg.notes,
                    "created_at": str(lg.created_at)[:19],
                }
                for lg in list_audit_logs(s, limit)
            ]

    # ── Settings ───────────────────────────────────────────────────────────

    @app.get("/api/settings")
    def settings_get():
        c = config.settings
        return {
            "user_name": c.user_name,
            "dispatch_x": c.dispatch_x,
            "dispatch_y": c.dispatch_y,
            "abc_threshold_a": c.abc.threshold_a,
            "abc_threshold_b": c.abc.threshold_b,
            "slotting_w_abc": c.slotting.abc_distance,
            "slotting_w_pick": c.slotting.pick_frequency,
            "slotting_w_weight": c.slotting.weight_level,
            "slotting_w_relocation": c.slotting.relocation,
            "expiry_alert_days": c.expiry_alert_days,
        }

    @app.put("/api/settings")
    def settings_save(body: SettingsUpdate):
        c = config.settings
        c.user_name = body.user_name
        c.dispatch_x = body.dispatch_x
        c.dispatch_y = body.dispatch_y
        c.abc.threshold_a = body.abc_threshold_a
        c.abc.threshold_b = body.abc_threshold_b
        c.slotting.abc_distance = body.slotting_w_abc
        c.slotting.pick_frequency = body.slotting_w_pick
        c.slotting.weight_level = body.slotting_w_weight
        c.slotting.relocation = body.slotting_w_relocation
        c.expiry_alert_days = body.expiry_alert_days
        config.save_settings()
        return {"ok": True}

    @app.post("/api/db/backup")
    def db_backup(dest: str):
        shutil.copy2(config.db_path, dest)
        return {"ok": True}

    return app
