"""ABC analysis using pandas."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from calidrux.config import config
from calidrux.db.models.abc_snapshot import AbcSnapshot
from calidrux.db.models.product import Product
from calidrux.services.audit import log_action


@dataclass
class AbcResult:
    sku: str
    name: str
    pick_frequency: int
    unit_cost: float
    auv: float
    cum_pct: float
    abc_class: str
    recommended_zone: str


def compute_abc(
    session: Session,
    threshold_a: float | None = None,
    threshold_b: float | None = None,
) -> list[AbcResult]:
    threshold_a = threshold_a if threshold_a is not None else config.settings.abc.threshold_a
    threshold_b = threshold_b if threshold_b is not None else config.settings.abc.threshold_b

    products = session.query(Product).all()
    if not products:
        return []

    df = pd.DataFrame(
        [
            {
                "sku": p.sku,
                "name": p.name,
                "pick_frequency": p.pick_frequency_30d,
                "unit_cost": float(p.unit_cost),
            }
            for p in products
        ]
    )
    df["auv"] = df["pick_frequency"] * df["unit_cost"]
    total = df["auv"].sum()
    if total <= 0:
        df["auv"] = 1.0
        total = df["auv"].sum()

    df = df.sort_values("auv", ascending=False).reset_index(drop=True)
    df["cum_pct"] = df["auv"].cumsum() / total
    df["cum_pct_prev"] = (df["auv"].cumsum() - df["auv"]) / total

    def classify(cum_prev: float) -> str:
        if cum_prev < threshold_a:
            return "A"
        if cum_prev < threshold_b:
            return "B"
        return "C"

    df["abc_class"] = df["cum_pct_prev"].apply(classify)
    zone_map = {"A": "Golden zone (near dispatch)", "B": "Mid zone", "C": "Bulk / rear zone"}
    df["recommended_zone"] = df["abc_class"].map(zone_map)

    return [
        AbcResult(
            sku=row.sku,
            name=row.name,
            pick_frequency=int(row.pick_frequency),
            unit_cost=float(row.unit_cost),
            auv=float(row.auv),
            cum_pct=float(row.cum_pct),
            abc_class=row.abc_class,
            recommended_zone=row.recommended_zone,
        )
        for _, row in df.iterrows()
    ]


def pareto_data(results: list[AbcResult]) -> pd.DataFrame:
    if not results:
        return pd.DataFrame(columns=["sku", "auv", "cum_pct"])
    df = pd.DataFrame(
        [{"sku": r.sku, "auv": r.auv, "cum_pct": r.cum_pct, "abc_class": r.abc_class} for r in results]
    )
    return df


def save_snapshot(session: Session, results: list[AbcResult], label: str) -> AbcSnapshot:
    payload = [
        {
            "sku": r.sku,
            "name": r.name,
            "auv": r.auv,
            "cum_pct": r.cum_pct,
            "abc_class": r.abc_class,
            "recommended_zone": r.recommended_zone,
        }
        for r in results
    ]
    snap = AbcSnapshot(
        label=label,
        threshold_a=config.settings.abc.threshold_a,
        threshold_b=config.settings.abc.threshold_b,
        results=payload,
        user_name=config.settings.user_name,
    )
    session.add(snap)
    session.flush()
    log_action(
        session,
        entity_type="abc_snapshot",
        action="create",
        entity_id=snap.id,
        after={"label": label, "count": len(payload)},
    )
    return snap


def list_snapshots(session: Session) -> list[AbcSnapshot]:
    return session.query(AbcSnapshot).order_by(AbcSnapshot.created_at.desc()).all()


def abc_class_map(session: Session) -> dict[str, str]:
    results = compute_abc(session)
    return {r.sku: r.abc_class for r in results}
