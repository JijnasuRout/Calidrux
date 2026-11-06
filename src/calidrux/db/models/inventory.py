"""Inventory model."""

from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.batch import Batch
    from calidrux.db.models.location import Location
    from calidrux.db.models.product import Product


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("product_id", "batch_id", "location_id", name="uq_inventory_slot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))

    product: Mapped[Product] = relationship(back_populates="inventory_items")
    batch: Mapped[Batch] = relationship(back_populates="inventory_items")
    location: Mapped[Location] = relationship(back_populates="inventory_items")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "product_id": self.product_id,
            "batch_id": self.batch_id,
            "location_id": self.location_id,
            "quantity": float(self.quantity),
        }
