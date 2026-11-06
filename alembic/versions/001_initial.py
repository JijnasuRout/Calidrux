"""Initial schema — mirrors SQLAlchemy models."""

from alembic import op
import sqlalchemy as sa


revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables created via init_db / Base.metadata.create_all in v1.
    # Migration stub for Alembic workflow; run init_db on first launch.
    pass


def downgrade() -> None:
    pass
