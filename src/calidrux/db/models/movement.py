"""Movement models."""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.batch import Batch
    from calidrux.db.models.location import Location
    from calidrux.db.models.product import Product


class MovementType(str, enum.Enum):
    RECEIPT = "receipt"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"
    PICK = "pick"


class Movement(Base):
    __tablename__ = "movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    movement_type: Mapped[MovementType] = mapped_column(Enum(MovementType))
    reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user_name: Mapped[str] = mapped_column(String(128), default="operator")

    lines: Mapped[list[MovementLine]] = relationship(back_populates="movement")


class MovementLine(Base):
    __tablename__ = "movement_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    movement_id: Mapped[int] = mapped_column(ForeignKey("movements.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"))
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    movement: Mapped[Movement] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    batch: Mapped[Batch] = relationship()
    from_location: Mapped[Location | None] = relationship(foreign_keys=[from_location_id])
    to_location: Mapped[Location | None] = relationship(foreign_keys=[to_location_id])
