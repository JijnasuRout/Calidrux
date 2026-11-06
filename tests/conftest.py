"""Test database helpers."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Point the app at a throwaway data dir *before* calidrux is imported, so the
# global SQLite engine never touches a real user database during tests.
os.environ.setdefault("CALIDRUX_DATA_DIR", tempfile.mkdtemp(prefix="calidrux-test-"))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from calidrux.db.session import Base


def setup_test_db(db_path: Path):
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return Session()
