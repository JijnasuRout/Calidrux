"""Seed sample pharmaceutical warehouse data."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from calidrux.db.models.batch import Batch, BatchStatus
from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.product import Product, StorageClass
from calidrux.db.session import get_session, init_db
from calidrux.services.inventory import create_batch, create_location, create_product, receive_stock


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
            f"{session.query(Location).count()} locations."
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

    ambient_locs: list[Location] = []
    for aisle in range(1, 6):
        for bay in range(1, 6):
            for level in range(1, 3):
                code = f"A{aisle:02d}-B{bay:02d}-L{level}"
                loc = create_location(
                    session,
                    code=code,
                    zone_type=ZoneType.AMBIENT,
                    aisle=aisle,
                    bay=bay,
                    level=level,
                    x_coord=float(aisle * 10 + bay),
                    y_coord=float(level * 3),
                    max_weight_kg=500,
                )
                ambient_locs.append(loc)

    cold_locs: list[Location] = []
    for i in range(1, 11):
        code = f"COLD-{i:02d}"
        loc = create_location(
            session,
            code=code,
            zone_type=ZoneType.COLD,
            aisle=10,
            bay=i,
            level=1,
            x_coord=100.0 + i * 2,
            y_coord=float(i),
            max_weight_kg=200,
        )
        cold_locs.append(loc)

    today = date.today()
    batch_specs = [
        (0, "LOT-A001", 90, BatchStatus.ACTIVE),
        (1, "LOT-A002", 180, BatchStatus.ACTIVE),
        (2, "LOT-A003", 45, BatchStatus.ACTIVE),
        (9, "LOT-C001", 120, BatchStatus.ACTIVE),
        (10, "LOT-C002", 60, BatchStatus.ACTIVE),
        (12, "LOT-R001", 365, BatchStatus.ACTIVE),
        (19, "LOT-S001", 720, BatchStatus.ACTIVE),
        (0, "LOT-Q001", 30, BatchStatus.QUARANTINE),
    ]

    batches: list[Batch] = []
    for pidx, lot, days, status in batch_specs:
        b = create_batch(
            session,
            product_id=products[pidx].id,
            lot_number=lot,
            expiry_date=today + timedelta(days=days),
        )
        b.status = status
        batches.append(b)

    session.flush()

    receive_stock(
        session,
        product_id=products[0].id,
        batch_id=batches[0].id,
        location_id=ambient_locs[0].id,
        quantity=Decimal("500"),
    )
    receive_stock(
        session,
        product_id=products[1].id,
        batch_id=batches[1].id,
        location_id=ambient_locs[5].id,
        quantity=Decimal("1200"),
    )
    receive_stock(
        session,
        product_id=products[2].id,
        batch_id=batches[2].id,
        location_id=ambient_locs[10].id,
        quantity=Decimal("800"),
    )
    receive_stock(
        session,
        product_id=products[9].id,
        batch_id=batches[3].id,
        location_id=cold_locs[0].id,
        quantity=Decimal("200"),
    )
    receive_stock(
        session,
        product_id=products[10].id,
        batch_id=batches[4].id,
        location_id=cold_locs[1].id,
        quantity=Decimal("150"),
    )
    receive_stock(
        session,
        product_id=products[12].id,
        batch_id=batches[5].id,
        location_id=ambient_locs[40].id,
        quantity=Decimal("50"),
    )
    receive_stock(
        session,
        product_id=products[19].id,
        batch_id=batches[6].id,
        location_id=ambient_locs[45].id,
        quantity=Decimal("30"),
    )


if __name__ == "__main__":
    seed()
