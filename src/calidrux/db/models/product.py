"""Product model."""

from __future__ import annotations

import enum
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Enum, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.batch import Batch
    from calidrux.db.models.inventory import Inventory


class StorageClass(str, enum.Enum):
    AMBIENT = "ambient"
    COLD = "cold"


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256))
    storage_class: Mapped[StorageClass] = mapped_column(
        Enum(StorageClass), default=StorageClass.AMBIENT
    )
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=Decimal("0"))
    pick_frequency_30d: Mapped[int] = mapped_column(default=0)

    batches: Mapped[list[Batch]] = relationship(back_populates="product")
    inventory_items: Mapped[list[Inventory]] = relationship(back_populates="product")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sku": self.sku,
            "name": self.name,
            "storage_class": self.storage_class.value,
            "unit_cost": float(self.unit_cost),
            "weight_kg": float(self.weight_kg),
            "pick_frequency_30d": self.pick_frequency_30d,
        }
