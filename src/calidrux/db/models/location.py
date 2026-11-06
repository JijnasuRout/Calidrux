"""Location model."""

from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.inventory import Inventory


class ZoneType(str, enum.Enum):
    AMBIENT = "ambient"
    COLD = "cold"


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    zone_type: Mapped[ZoneType] = mapped_column(Enum(ZoneType), default=ZoneType.AMBIENT)
    aisle: Mapped[int] = mapped_column(Integer, default=0)
    bay: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=0)
    x_coord: Mapped[float] = mapped_column(Float, default=0.0)
    y_coord: Mapped[float] = mapped_column(Float, default=0.0)
    max_weight_kg: Mapped[int] = mapped_column(Integer, default=500)
    # Units a single slot can hold (used for occupancy and put-away checks).
    capacity_units: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    # Locations removed from the layout are deactivated, never deleted, so
    # movement/pick history that references them stays intact.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    inventory_items: Mapped[list[Inventory]] = relationship(back_populates="location")

    def distance_to(self, x: float, y: float) -> float:
        return ((self.x_coord - x) ** 2 + (self.y_coord - y) ** 2) ** 0.5

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "zone_type": self.zone_type.value,
            "aisle": self.aisle,
            "bay": self.bay,
            "level": self.level,
            "x_coord": self.x_coord,
            "y_coord": self.y_coord,
            "max_weight_kg": self.max_weight_kg,
            "capacity_units": self.capacity_units,
            "active": self.active,
        }
