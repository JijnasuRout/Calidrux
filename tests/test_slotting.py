"""Slotting optimization tests."""

from decimal import Decimal

from calidrux.db.models.location import Location, ZoneType
from calidrux.db.models.product import Product, StorageClass
from calidrux.optimization.slotting import optimize_slotting
from tests.conftest import setup_test_db


def test_slotting_runs(tmp_path, monkeypatch):
    from calidrux import config as cfg_mod

    db_path = tmp_path / "test.db"
    monkeypatch.setattr(cfg_mod.config, "data_dir", tmp_path)
    monkeypatch.setattr(cfg_mod.config, "db_path", db_path)
    monkeypatch.setattr(cfg_mod.config, "settings_path", tmp_path / "settings.json")

    session = setup_test_db(db_path)
    p = Product(
        sku="PH-T1",
        name="Test",
        storage_class=StorageClass.AMBIENT,
        unit_cost=Decimal("5"),
        weight_kg=Decimal("1"),
        pick_frequency_30d=50,
    )
    session.add(p)
    session.add(
        Location(
            code="L1",
            zone_type=ZoneType.AMBIENT,
            aisle=1,
            bay=1,
            level=1,
            x_coord=5,
            y_coord=5,
        )
    )
    session.add(
        Location(
            code="L2",
            zone_type=ZoneType.AMBIENT,
            aisle=2,
            bay=1,
            level=1,
            x_coord=20,
            y_coord=5,
        )
    )
    session.commit()

    run_id, results = optimize_slotting(session)
    session.close()
    assert run_id
    assert isinstance(results, list)
