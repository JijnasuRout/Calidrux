"""Warehouse layout model — the configurable size and zoning of the building."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from calidrux.db.session import Base


class WarehouseLayout(Base):
    __tablename__ = "warehouse_layout"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), default="Main Warehouse")
    aisles: Mapped[int] = mapped_column(Integer, default=6)
    bays_per_aisle: Mapped[int] = mapped_column(Integer, default=8)
    levels: Mapped[int] = mapped_column(Integer, default=4)
    cold_aisles: Mapped[list] = mapped_column(JSON, default=list)
    slot_capacity_units: Mapped[int] = mapped_column(Integer, default=1000)
    cold_slot_capacity_units: Mapped[int] = mapped_column(Integer, default=400)
    max_weight_kg: Mapped[int] = mapped_column(Integer, default=500)
    cold_max_weight_kg: Mapped[int] = mapped_column(Integer, default=200)
    aisle_spacing_m: Mapped[float] = mapped_column(Float, default=3.5)
    bay_width_m: Mapped[float] = mapped_column(Float, default=2.7)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "aisles": self.aisles,
            "bays_per_aisle": self.bays_per_aisle,
            "levels": self.levels,
            "cold_aisles": sorted(int(a) for a in (self.cold_aisles or [])),
            "slot_capacity_units": self.slot_capacity_units,
            "cold_slot_capacity_units": self.cold_slot_capacity_units,
            "max_weight_kg": self.max_weight_kg,
            "cold_max_weight_kg": self.cold_max_weight_kg,
            "aisle_spacing_m": self.aisle_spacing_m,
            "bay_width_m": self.bay_width_m,
        }
