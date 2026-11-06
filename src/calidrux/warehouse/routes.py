"""REST routes for warehouse operations (mounted under /api/warehouse)."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from calidrux.db.session import get_session
from calidrux.services.inventory import InventoryError
from calidrux.warehouse import service
from calidrux.warehouse.layout import (
    LayoutConflict,
    LayoutError,
    LayoutSpec,
    apply_layout,
    get_layout,
    plan_layout,
    public_plan,
)

router = APIRouter(prefix="/api/warehouse", tags=["warehouse"])


class LayoutBody(BaseModel):
    name: str = "Main Warehouse"
    aisles: int = Field(6, ge=1, le=30)
    bays_per_aisle: int = Field(8, ge=1, le=40)
    levels: int = Field(4, ge=1, le=8)
    cold_aisles: List[int] = []
    slot_capacity_units: int = Field(1000, gt=0)
    cold_slot_capacity_units: int = Field(400, gt=0)
    max_weight_kg: int = Field(500, gt=0)
    cold_max_weight_kg: int = Field(200, gt=0)
    aisle_spacing_m: float = Field(3.5, gt=0)
    bay_width_m: float = Field(2.7, gt=0)

    def spec(self) -> LayoutSpec:
        return LayoutSpec(**self.model_dump())


class SuggestBody(BaseModel):
    product_id: int
    quantity: float
    lot_number: Optional[str] = None


class ReceiveBody(BaseModel):
    product_id: int
    lot_number: str
    expiry_date: date
    quantity: float
    location_id: int
    reference: Optional[str] = None


class MoveBody(BaseModel):
    inventory_id: int
    to_location_id: int
    quantity: float


class StatusBody(BaseModel):
    status: str


def _bad(e: Exception, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=str(e))


@router.get("/floor")
def floor():
    with get_session() as s:
        return service.floor_snapshot(s)


@router.get("/racks/{aisle}/{bay}")
def rack(aisle: int, bay: int):
    try:
        with get_session() as s:
            return service.rack_detail(s, aisle, bay)
    except InventoryError as e:
        raise _bad(e, 404)


@router.get("/expiry")
def expiry():
    with get_session() as s:
        return service.expiry_board(s)


@router.get("/layout")
def layout_get():
    with get_session() as s:
        spec, inferred = get_layout(s)
        return {"layout": spec.to_dict(), "inferred": inferred}


@router.post("/layout/preview")
def layout_preview(body: LayoutBody):
    try:
        with get_session() as s:
            plan = public_plan(plan_layout(s, body.spec()))
            s.rollback()
            return plan
    except LayoutError as e:
        raise _bad(e)


@router.put("/layout")
def layout_apply(body: LayoutBody):
    try:
        with get_session() as s:
            return apply_layout(s, body.spec())
    except LayoutConflict as e:
        raise HTTPException(status_code=409, detail={"message": str(e), "plan": e.plan})
    except LayoutError as e:
        raise _bad(e)


@router.post("/putaway/suggest")
def putaway_suggest(body: SuggestBody):
    try:
        with get_session() as s:
            return service.suggest_putaway(s, body.product_id, body.quantity, body.lot_number)
    except InventoryError as e:
        raise _bad(e)


@router.post("/receive", status_code=201)
def receive(body: ReceiveBody):
    try:
        with get_session() as s:
            return service.receive_into_slot(s, **body.model_dump())
    except InventoryError as e:
        raise _bad(e)


@router.get("/receipts")
def receipts(limit: int = 8):
    with get_session() as s:
        return service.recent_receipts(s, limit)


@router.post("/move")
def move(body: MoveBody):
    try:
        with get_session() as s:
            return service.move_stock(s, **body.model_dump())
    except InventoryError as e:
        raise _bad(e)


@router.post("/batches/{batch_id}/status")
def batch_status(batch_id: int, body: StatusBody):
    try:
        with get_session() as s:
            return service.set_batch_status(s, batch_id, body.status)
    except InventoryError as e:
        raise _bad(e)


@router.post("/demo-stock")
def demo_stock():
    with get_session() as s:
        return service.populate_demo_stock(s)
