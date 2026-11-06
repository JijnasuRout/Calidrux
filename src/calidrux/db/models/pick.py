"""Pick list models."""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from calidrux.db.session import Base

if TYPE_CHECKING:
    from calidrux.db.models.batch import Batch
    from calidrux.db.models.location import Location
    from calidrux.db.models.product import Product


class PickListStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PickList(Base):
    __tablename__ = "pick_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[PickListStatus] = mapped_column(
        Enum(PickListStatus), default=PickListStatus.OPEN
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    optimized_distance_m: Mapped[float | None] = mapped_column(nullable=True)
    baseline_distance_m: Mapped[float | None] = mapped_column(nullable=True)
    pick_duration_seconds: Mapped[int | None] = mapped_column(nullable=True)

    lines: Mapped[list[PickLine]] = relationship(
        back_populates="pick_list", order_by="PickLine.sequence"
    )


class PickLine(Base):
    __tablename__ = "pick_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    pick_list_id: Mapped[int] = mapped_column(ForeignKey("pick_lists.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    picked: Mapped[bool] = mapped_column(default=False)
    pick_error: Mapped[str | None] = mapped_column(String(256), nullable=True)

    pick_list: Mapped[PickList] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    batch: Mapped[Batch] = relationship()
    location: Mapped[Location] = relationship()
