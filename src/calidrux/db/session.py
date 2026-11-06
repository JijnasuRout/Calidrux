"""Database session and engine."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from calidrux.config import config


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{config.db_path}",
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@contextmanager
def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# Columns added after the first release. SQLite's create_all() never alters an
# existing table, so older databases get these added in place on startup.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "locations": {
        "capacity_units": "INTEGER NOT NULL DEFAULT 1000",
        "active": "BOOLEAN NOT NULL DEFAULT 1",
    },
}


def _migrate(bind) -> None:
    with bind.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not existing:
                continue
            for name, ddl in columns.items():
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def init_db(bind=None) -> None:
    from calidrux.db import models  # noqa: F401

    bind = bind or engine
    Base.metadata.create_all(bind=bind)
    _migrate(bind)
