"""add_search_tuning_models

Revision ID: f7d6a5e4b3c2
Revises: 6bd0708b73f1
Create Date: 2026-07-18 10:15:20.123456
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f7d6a5e4b3c2'
down_revision: Union[str, None] = '6bd0708b73f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create search_settings table
    op.execute("""
    CREATE TABLE IF NOT EXISTS search_settings (
        key VARCHAR(100) NOT NULL, 
        value VARCHAR(255) NOT NULL, 
        PRIMARY KEY (key)
    )
    """)

    # Populate search_settings defaults
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('hybrid_alpha', '0.5')")
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('query_expansion_enabled', 'true')")
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('hyde_enabled', 'true')")
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('rerank_enabled', 'true')")
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('rerank_top_k', '5')")
    op.execute("INSERT OR IGNORE INTO search_settings (key, value) VALUES ('retrieval_top_k', '10')")

    # Create search_analytics table
    op.execute("""
    CREATE TABLE IF NOT EXISTS search_analytics (
        id VARCHAR(36) NOT NULL, 
        query VARCHAR(1000) NOT NULL, 
        user_id VARCHAR(36), 
        session_id VARCHAR(36), 
        clicked BOOLEAN DEFAULT 0, 
        click_rank INTEGER, 
        reformulated BOOLEAN DEFAULT 0, 
        created_at DATETIME, 
        PRIMARY KEY (id)
    )
    """)


def downgrade() -> None:
    op.drop_table('search_settings')
    op.drop_table('search_analytics')
