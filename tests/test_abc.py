"""ABC analysis tests."""

from decimal import Decimal

from calidrux.db.models.product import Product, StorageClass
from calidrux.optimization.abc import compute_abc
from tests.conftest import setup_test_db


def test_abc_classification(tmp_path, monkeypatch):
    from calidrux import config as cfg_mod

    db_path = tmp_path / "test.db"
    monkeypatch.setattr(cfg_mod.config, "data_dir", tmp_path)
    monkeypatch.setattr(cfg_mod.config, "db_path", db_path)
    monkeypatch.setattr(cfg_mod.config, "settings_path", tmp_path / "settings.json")

    session = setup_test_db(db_path)
    session.add(
        Product(
            sku="A-SKU",
            name="High mover",
            storage_class=StorageClass.AMBIENT,
            unit_cost=Decimal("10"),
            pick_frequency_30d=100,
        )
    )
    session.add(
        Product(
            sku="C-SKU",
            name="Low mover",
            storage_class=StorageClass.AMBIENT,
            unit_cost=Decimal("1"),
            pick_frequency_30d=1,
        )
    )
    session.commit()

    results = compute_abc(session)
    session.close()
    assert len(results) == 2
    assert results[0].abc_class == "A"
    assert results[0].sku == "A-SKU"
