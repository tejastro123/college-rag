"""add_compliance_models

Revision ID: a1b2c3d4e5f6
Revises: f7d6a5e4b3c2
Create Date: 2026-07-18 10:20:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f7d6a5e4b3c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create data_residency_configs table
    op.execute("""
    CREATE TABLE IF NOT EXISTS data_residency_configs (
        id VARCHAR(36) NOT NULL,
        scope VARCHAR(50) NOT NULL,
        scope_id VARCHAR(36),
        allowed_regions TEXT,
        enforce_strict BOOLEAN DEFAULT 1,
        updated_at DATETIME,
        PRIMARY KEY (id)
    )
    """)

    # Populate system level residency defaults
    op.execute("INSERT OR IGNORE INTO data_residency_configs (id, scope, scope_id, allowed_regions, enforce_strict, updated_at) VALUES ('system-residency-id', 'system', NULL, '[\"US\", \"EU\"]', 1, datetime('now'))")

    # Create encryption_keys table
    op.execute("""
    CREATE TABLE IF NOT EXISTS encryption_keys (
        id VARCHAR(36) NOT NULL,
        key_alias VARCHAR(100) NOT NULL,
        algorithm VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        version INTEGER DEFAULT 1,
        created_at DATETIME,
        rotated_at DATETIME,
        PRIMARY KEY (id)
    )
    """)

    # Populate default master encryption key
    op.execute("INSERT OR IGNORE INTO encryption_keys (id, key_alias, algorithm, status, version, created_at, rotated_at) VALUES ('initial-master-key-id', 'master-doc-key', 'AES-256-GCM', 'active', 1, datetime('now'), NULL)")


def downgrade() -> None:
    op.drop_table('data_residency_configs')
    op.drop_table('encryption_keys')
