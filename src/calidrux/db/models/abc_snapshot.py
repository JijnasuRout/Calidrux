"""ABC snapshot model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from calidrux.db.session import Base


class AbcSnapshot(Base):
    __tablename__ = "abc_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(128))
    threshold_a: Mapped[float] = mapped_column(default=0.80)
    threshold_b: Mapped[float] = mapped_column(default=0.95)
    results: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user_name: Mapped[str] = mapped_column(String(128), default="operator")
