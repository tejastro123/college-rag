"""add_security_models

Revision ID: 15077c4d2dd7
Revises: 0002
Create Date: 2026-07-17 22:46:07.230204
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '15077c4d2dd7'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create api_keys table if not exists
    op.execute("""
    CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(36) NOT NULL, 
        name VARCHAR(255) NOT NULL, 
        key_prefix VARCHAR(10) NOT NULL, 
        hashed_key VARCHAR(255) NOT NULL, 
        owner_id VARCHAR(36) NOT NULL, 
        organization_id VARCHAR(36), 
        is_active BOOLEAN, 
        created_at DATETIME, 
        expires_at DATETIME, 
        last_used_at DATETIME, 
        PRIMARY KEY (id), 
        FOREIGN KEY(owner_id) REFERENCES users (id), 
        FOREIGN KEY(organization_id) REFERENCES organizations (id)
    )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_api_keys_hashed_key ON api_keys (hashed_key)")

    # Create webhook_subscriptions table if not exists
    op.execute("""
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id VARCHAR(36) NOT NULL, 
        url VARCHAR(500) NOT NULL, 
        secret VARCHAR(255) NOT NULL, 
        event_types JSON NOT NULL, 
        organization_id VARCHAR(36), 
        is_active BOOLEAN, 
        created_at DATETIME, 
        PRIMARY KEY (id), 
        FOREIGN KEY(organization_id) REFERENCES organizations (id)
    )
    """)


def downgrade() -> None:
    op.drop_table('api_keys')
    op.drop_table('webhook_subscriptions')
