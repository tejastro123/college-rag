"""add_lifecycle_models

Revision ID: 6bd0708b73f1
Revises: 15077c4d2dd7
Create Date: 2026-07-17 22:59:47.545322
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '6bd0708b73f1'
down_revision: Union[str, None] = '15077c4d2dd7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create data_retention_policies table if not exists
    op.execute("""
    CREATE TABLE IF NOT EXISTS data_retention_policies (
        id VARCHAR(36) NOT NULL, 
        organization_id VARCHAR(36), 
        policy_type VARCHAR(100) NOT NULL, 
        retention_days INTEGER NOT NULL, 
        action VARCHAR(50) NOT NULL, 
        is_active BOOLEAN, 
        created_at DATETIME, 
        updated_at DATETIME, 
        PRIMARY KEY (id), 
        FOREIGN KEY(organization_id) REFERENCES organizations (id)
    )
    """)

    # Create backup_history table if not exists
    op.execute("""
    CREATE TABLE IF NOT EXISTS backup_history (
        id VARCHAR(36) NOT NULL, 
        filename VARCHAR(255) NOT NULL, 
        file_path VARCHAR(1000) NOT NULL, 
        file_size INTEGER NOT NULL, 
        status VARCHAR(50) NOT NULL, 
        created_at DATETIME, 
        PRIMARY KEY (id)
    )
    """)

    # Create gdpr_requests table if not exists
    op.execute("""
    CREATE TABLE IF NOT EXISTS gdpr_requests (
        id VARCHAR(36) NOT NULL, 
        user_id VARCHAR(36) NOT NULL, 
        request_type VARCHAR(50) NOT NULL, 
        status VARCHAR(50) NOT NULL, 
        download_url VARCHAR(500), 
        created_at DATETIME, 
        completed_at DATETIME, 
        PRIMARY KEY (id), 
        FOREIGN KEY(user_id) REFERENCES users (id)
    )
    """)


def downgrade() -> None:
    op.drop_table('data_retention_policies')
    op.drop_table('backup_history')
    op.drop_table('gdpr_requests')
