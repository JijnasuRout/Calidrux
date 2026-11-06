"""Inventory service — CRUD, FEFO, cold-chain validation."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from calidrux.config import config
from calidrux.db.models.batch import Batch, BatchStatus
from calidrux.db.models.inventory import Inventory
from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.movement import Movement, MovementLine, MovementType
from calidrux.db.models.product import Product, StorageClass
from calidrux.services.audit import log_action


class InventoryError(Exception):
    pass


def validate_cold_chain(product: Product, location: Location) -> None:
    if product.storage_class == StorageClass.COLD and location.zone_type != ZoneType.COLD:
        raise InventoryError(
            f"Cold-chain product {product.sku} cannot be stored in ambient location {location.code}"
        )
    if product.storage_class == StorageClass.AMBIENT and location.zone_type == ZoneType.COLD:
        raise InventoryError(
            f"Ambient product {product.sku} cannot be stored in cold location {location.code}"
        )


def validate_batch_pickable(batch: Batch) -> None:
    if batch.status == BatchStatus.QUARANTINE:
        raise InventoryError(f"Batch {batch.lot_number} is in quarantine")
    if batch.status == BatchStatus.EXPIRED:
        raise InventoryError(f"Batch {batch.lot_number} is expired")


# --- Product CRUD ---


def list_products(session: Session) -> list[Product]:
    return session.query(Product).order_by(Product.sku).all()


def get_product(session: Session, product_id: int) -> Product | None:
    return session.get(Product, product_id)


def create_product(session: Session, **kwargs: Any) -> Product:
    product = Product(**kwargs)
    session.add(product)
    session.flush()
    log_action(session, entity_type="product", action="create", entity_id=product.id, after=product.to_dict())
    return product


def update_product(session: Session, product: Product, **kwargs: Any) -> Product:
    before = product.to_dict()
    for key, value in kwargs.items():
        setattr(product, key, value)
    session.flush()
    log_action(session, entity_type="product", action="update", entity_id=product.id, before=before, after=product.to_dict())
    return product


def delete_product(session: Session, product: Product) -> None:
    before = product.to_dict()
    session.delete(product)
    log_action(session, entity_type="product", action="delete", entity_id=product.id, before=before)


# --- Location CRUD ---


def list_locations(session: Session, include_inactive: bool = False) -> list[Location]:
    q = session.query(Location)
    if not include_inactive:
        q = q.filter(Location.active.is_(True))
    return q.order_by(Location.code).all()


def create_location(session: Session, **kwargs: Any) -> Location:
    loc = Location(**kwargs)
    session.add(loc)
    session.flush()
    log_action(session, entity_type="location", action="create", entity_id=loc.id, after=loc.to_dict())
    return loc


def update_location(session: Session, location: Location, **kwargs: Any) -> Location:
    before = location.to_dict()
    for key, value in kwargs.items():
        setattr(location, key, value)
    session.flush()
    log_action(session, entity_type="location", action="update", entity_id=location.id, before=before, after=location.to_dict())
    return location


# --- Batch CRUD ---


def list_batches(session: Session, product_id: int | None = None) -> list[Batch]:
    q = session.query(Batch).options(joinedload(Batch.product))
    if product_id:
        q = q.filter(Batch.product_id == product_id)
    return q.order_by(Batch.expiry_date).all()


def create_batch(session: Session, **kwargs: Any) -> Batch:
    batch = Batch(**kwargs)
    session.add(batch)
    session.flush()
    log_action(session, entity_type="batch", action="create", entity_id=batch.id, after=batch.to_dict())
    return batch


# --- Stock operations ---


def _get_or_create_inventory(
    session: Session, product_id: int, batch_id: int, location_id: int
) -> Inventory:
    inv = (
        session.query(Inventory)
        .filter_by(product_id=product_id, batch_id=batch_id, location_id=location_id)
        .first()
    )
    if inv is None:
        inv = Inventory(product_id=product_id, batch_id=batch_id, location_id=location_id, quantity=Decimal("0"))
        session.add(inv)
        session.flush()
    return inv


def receive_stock(
    session: Session,
    *,
    product_id: int,
    batch_id: int,
    location_id: int,
    quantity: Decimal,
    reference: str | None = None,
) -> Movement:
    product = session.get(Product, product_id)
    batch = session.get(Batch, batch_id)
    location = session.get(Location, location_id)
    if not product or not batch or not location:
        raise InventoryError("Invalid product, batch, or location")
    if not location.active:
        raise InventoryError(f"Location {location.code} is not part of the current layout")
    validate_cold_chain(product, location)
    validate_batch_pickable(batch)

    inv = _get_or_create_inventory(session, product_id, batch_id, location_id)
    before = inv.to_dict()
    inv.quantity += quantity

    movement = Movement(
        movement_type=MovementType.RECEIPT,
        reference=reference,
        user_name=config.settings.user_name,
    )
    session.add(movement)
    session.flush()
    session.add(
        MovementLine(
            movement_id=movement.id,
            product_id=product_id,
            batch_id=batch_id,
            to_location_id=location_id,
            quantity=quantity,
        )
    )
    log_action(
        session,
        entity_type="inventory",
        action="receive",
        entity_id=inv.id,
        before=before,
        after=inv.to_dict(),
        notes=f"Received {quantity} units",
    )
    return movement


def transfer_stock(
    session: Session,
    *,
    product_id: int,
    batch_id: int,
    from_location_id: int,
    to_location_id: int,
    quantity: Decimal,
    reference: str | None = None,
) -> Movement:
    product = session.get(Product, product_id)
    batch = session.get(Batch, batch_id)
    from_loc = session.get(Location, from_location_id)
    to_loc = session.get(Location, to_location_id)
    if not product or not batch or not from_loc or not to_loc:
        raise InventoryError("Invalid transfer parameters")
    if not to_loc.active:
        raise InventoryError(f"Location {to_loc.code} is not part of the current layout")
    validate_cold_chain(product, to_loc)

    src = _get_or_create_inventory(session, product_id, batch_id, from_location_id)
    if src.quantity < quantity:
        raise InventoryError(f"Insufficient stock at {from_loc.code}")

    dst = _get_or_create_inventory(session, product_id, batch_id, to_location_id)
    src_before = src.to_dict()
    dst_before = dst.to_dict()
    src.quantity -= quantity
    dst.quantity += quantity

    movement = Movement(
        movement_type=MovementType.TRANSFER,
        reference=reference,
        user_name=config.settings.user_name,
    )
    session.add(movement)
    session.flush()
    session.add(
        MovementLine(
            movement_id=movement.id,
            product_id=product_id,
            batch_id=batch_id,
            from_location_id=from_location_id,
            to_location_id=to_location_id,
            quantity=quantity,
        )
    )
    log_action(
        session,
        entity_type="inventory",
        action="transfer",
        entity_id=src.id,
        before=src_before,
        after=src.to_dict(),
        notes=f"Transferred {quantity} to {to_loc.code}",
    )
    log_action(
        session,
        entity_type="inventory",
        action="transfer",
        entity_id=dst.id,
        before=dst_before,
        after=dst.to_dict(),
    )
    return movement


def adjust_stock(
    session: Session,
    *,
    product_id: int,
    batch_id: int,
    location_id: int,
    new_quantity: Decimal,
    reason: str,
) -> Movement:
    inv = _get_or_create_inventory(session, product_id, batch_id, location_id)
    before = inv.to_dict()
    delta = new_quantity - inv.quantity
    inv.quantity = new_quantity

    movement = Movement(
        movement_type=MovementType.ADJUSTMENT,
        reason=reason,
        user_name=config.settings.user_name,
    )
    session.add(movement)
    session.flush()
    session.add(
        MovementLine(
            movement_id=movement.id,
            product_id=product_id,
            batch_id=batch_id,
            to_location_id=location_id,
            quantity=delta,
        )
    )
    log_action(
        session,
        entity_type="inventory",
        action="adjust",
        entity_id=inv.id,
        before=before,
        after=inv.to_dict(),
        notes=reason,
    )
    return movement


def list_inventory(session: Session) -> list[Inventory]:
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


def list_movements(session: Session, limit: int = 200) -> list[Movement]:
    return (
        session.query(Movement)
        .options(joinedload(Movement.lines))
        .order_by(Movement.created_at.desc())
        .limit(limit)
        .all()
    )


def allocate_fefo(
    session: Session, product_id: int, quantity: Decimal
) -> list[tuple[Inventory, Decimal]]:
    """Allocate quantity using FEFO across available inventory."""
    rows = (
        session.query(Inventory)
        .join(Batch)
        .join(Location)
        .options(joinedload(Inventory.batch), joinedload(Inventory.location))
        .filter(
            Inventory.product_id == product_id,
            Inventory.quantity > 0,
            Batch.status == BatchStatus.ACTIVE,
        )
        .order_by(Batch.expiry_date.asc())
        .all()
    )
    remaining = quantity
    allocations: list[tuple[Inventory, Decimal]] = []
    for inv in rows:
        if remaining <= 0:
            break
        take = min(inv.quantity, remaining)
        allocations.append((inv, take))
        remaining -= take
    if remaining > 0:
        raise InventoryError(f"Insufficient stock for product id {product_id}")
    return allocations


def get_expiry_alerts(session: Session) -> list[dict[str, Any]]:
    today = date.today()
    alerts = []
    batches = (
        session.query(Batch)
        .options(joinedload(Batch.product))
        .filter(Batch.status == BatchStatus.ACTIVE)
        .all()
    )
    for batch in batches:
        days_left = (batch.expiry_date - today).days
        for window in config.settings.expiry_alert_days:
            if 0 <= days_left <= window:
                alerts.append(
                    {
                        "product_sku": batch.product.sku,
                        "lot_number": batch.lot_number,
                        "expiry_date": batch.expiry_date.isoformat(),
                        "days_left": days_left,
                        "window": window,
                    }
                )
                break
    return sorted(alerts, key=lambda x: x["days_left"])


def import_products_csv(session: Session, path: str) -> int:
    df = pd.read_csv(path)
    count = 0
    for _, row in df.iterrows():
        storage = StorageClass(row.get("storage_class", "ambient"))
        existing = session.query(Product).filter_by(sku=str(row["sku"])).first()
        if existing:
            update_product(
                session,
                existing,
                name=str(row["name"]),
                storage_class=storage,
                unit_cost=Decimal(str(row.get("unit_cost", 0))),
                weight_kg=Decimal(str(row.get("weight_kg", 0))),
                pick_frequency_30d=int(row.get("pick_frequency_30d", 0)),
            )
        else:
            create_product(
                session,
                sku=str(row["sku"]),
                name=str(row["name"]),
                storage_class=storage,
                unit_cost=Decimal(str(row.get("unit_cost", 0))),
                weight_kg=Decimal(str(row.get("weight_kg", 0))),
                pick_frequency_30d=int(row.get("pick_frequency_30d", 0)),
            )
        count += 1
    return count


def import_locations_csv(session: Session, path: str) -> int:
    df = pd.read_csv(path)
    count = 0
    for _, row in df.iterrows():
        zone = ZoneType(row.get("zone_type", "ambient"))
        existing = session.query(Location).filter_by(code=str(row["code"])).first()
        data = {
            "zone_type": zone,
            "aisle": int(row.get("aisle", 0)),
            "bay": int(row.get("bay", 0)),
            "level": int(row.get("level", 0)),
            "x_coord": float(row.get("x_coord", 0)),
            "y_coord": float(row.get("y_coord", 0)),
            "max_weight_kg": int(row.get("max_weight_kg", 500)),
        }
        if existing:
            update_location(session, existing, **data)
        else:
            create_location(session, code=str(row["code"]), **data)
        count += 1
    return count


def get_dashboard_kpis(session: Session) -> dict[str, Any]:
    from calidrux.db.models.pick import PickList, PickListStatus

    product_count = session.query(func.count(Product.id)).scalar() or 0
    location_count = session.query(func.count(Location.id)).filter(Location.active.is_(True)).scalar() or 0
    stock_lines = session.query(func.count(Inventory.id)).filter(Inventory.quantity > 0).scalar() or 0
    open_picks = (
        session.query(func.count(PickList.id))
        .filter(PickList.status == PickListStatus.OPEN)
        .scalar()
        or 0
    )
    return {
        "product_count": product_count,
        "location_count": location_count,
        "stock_lines": stock_lines,
        "open_picks": open_picks,
        "expiry_alerts": len(get_expiry_alerts(session)),
    }
