"""Seed sample pharmaceutical warehouse data."""

from __future__ import annotations

from decimal import Decimal

from calidrux.db.models.location import Location
from calidrux.db.models.product import Product, StorageClass
from calidrux.db.session import get_session, init_db
from calidrux.services.inventory import create_product
from calidrux.warehouse.layout import LayoutSpec, apply_layout
from calidrux.warehouse.service import populate_demo_stock


def seed_if_empty() -> bool:
    """Load sample data on first launch. Returns True if seeding ran."""
    init_db()
    with get_session() as session:
        if session.query(Product).count() > 0:
            return False
        _seed_data(session)
        return True


def seed() -> None:
    init_db()
    with get_session() as session:
        if session.query(Product).count() > 0:
            print("Database already seeded.")
            return
        _seed_data(session)
        print(
            f"Seeded {session.query(Product).count()} products, "
            f"{session.query(Location).filter(Location.active.is_(True)).count()} storage slots."
        )


def _seed_data(session) -> None:
    products_data = [
        ("PH-001", "Amoxicillin 500mg", StorageClass.AMBIENT, 12.50, 0.2, 450),
        ("PH-002", "Paracetamol 500mg", StorageClass.AMBIENT, 3.20, 0.15, 820),
        ("PH-003", "Ibuprofen 400mg", StorageClass.AMBIENT, 5.80, 0.18, 610),
        ("PH-004", "Metformin 850mg", StorageClass.AMBIENT, 8.40, 0.22, 390),
        ("PH-005", "Atorvastatin 20mg", StorageClass.AMBIENT, 15.60, 0.12, 280),
        ("PH-006", "Omeprazole 20mg", StorageClass.AMBIENT, 9.90, 0.14, 340),
        ("PH-007", "Losartan 50mg", StorageClass.AMBIENT, 11.20, 0.16, 220),
        ("PH-008", "Amlodipine 5mg", StorageClass.AMBIENT, 7.30, 0.11, 190),
        ("PH-009", "Salbutamol Inhaler", StorageClass.AMBIENT, 22.00, 0.25, 150),
        ("PH-010", "Insulin Glargine", StorageClass.COLD, 85.00, 0.08, 120),
        ("PH-011", "MRNA Vaccine", StorageClass.COLD, 120.00, 0.05, 45),
        ("PH-012", "Hep B Vaccine", StorageClass.COLD, 65.00, 0.06, 38),
        ("PH-013", "Rare Oncology Drug", StorageClass.AMBIENT, 450.00, 0.03, 8),
        ("PH-014", "Vitamin D3 1000IU", StorageClass.AMBIENT, 4.50, 0.2, 95),
        ("PH-015", "Antibiotic Suspension", StorageClass.AMBIENT, 18.00, 0.35, 175),
        ("PH-016", "Eye Drops Sterile", StorageClass.AMBIENT, 14.00, 0.05, 62),
        ("PH-017", "Controlled Substance C2", StorageClass.AMBIENT, 95.00, 0.02, 25),
        ("PH-018", "Cold Chain Biologic", StorageClass.COLD, 210.00, 0.04, 15),
        ("PH-019", "Generic Statin", StorageClass.AMBIENT, 2.80, 0.1, 540),
        ("PH-020", "Slow Mover Specialty", StorageClass.AMBIENT, 320.00, 0.02, 3),
    ]

    products: list[Product] = []
    for sku, name, storage, cost, weight, freq in products_data:
        p = create_product(
            session,
            sku=sku,
            name=name,
            storage_class=storage,
            unit_cost=Decimal(str(cost)),
            weight_kg=Decimal(str(weight)),
            pick_frequency_30d=freq,
        )
        products.append(p)

    # 6 aisles x 8 bays x 4 levels; aisle 6 is the 2–8 °C cold room.
    apply_layout(session, LayoutSpec(aisles=6, bays_per_aisle=8, levels=4, cold_aisles=[6]))
    session.flush()
    populate_demo_stock(session)
    session.flush()
    _seed_pick_history(session)


def _seed_pick_history(session) -> None:
    """A few routed pick lists so the picking metrics have something to show."""
    import random
    from datetime import date

    from calidrux.db.models.batch import Batch, BatchStatus
    from calidrux.db.models.inventory import Inventory
    from calidrux.optimization.picking import complete_pick_list, create_pick_list

    rng = random.Random(11)
    pickable = sorted({
        pid for (pid,) in session.query(Inventory.product_id).join(Batch)
        .filter(Inventory.quantity > 20, Batch.status == BatchStatus.ACTIVE, Batch.expiry_date > date.today())
    })
    for n in range(5):
        lines = [{"product_id": pid, "quantity": rng.randint(2, 15)} for pid in rng.sample(pickable, min(len(pickable), rng.randint(4, 7)))]
        pl = create_pick_list(session, f"PL-DEMO-{n + 1:03d}", lines)
        session.flush()
        if n < 4:
            complete_pick_list(session, pl.id, duration_seconds=len(lines) * rng.randint(40, 75))


if __name__ == "__main__":
    seed()
