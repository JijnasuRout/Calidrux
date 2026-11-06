"""Batch model."""

from __future__ import annotations

import enum
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.inventory import Inventory
    from calidrux.db.models.product import Product


class BatchStatus(str, enum.Enum):
    ACTIVE = "active"
    QUARANTINE = "quarantine"
    EXPIRED = "expired"


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("product_id", "lot_number", name="uq_batch_lot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    lot_number: Mapped[str] = mapped_column(String(64))
    expiry_date: Mapped[date] = mapped_column(Date)
    status: Mapped[BatchStatus] = mapped_column(Enum(BatchStatus), default=BatchStatus.ACTIVE)

    product: Mapped[Product] = relationship(back_populates="batches")
    inventory_items: Mapped[list[Inventory]] = relationship(back_populates="batch")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "product_id": self.product_id,
            "lot_number": self.lot_number,
            "expiry_date": self.expiry_date.isoformat(),
            "status": self.status.value,
        }
