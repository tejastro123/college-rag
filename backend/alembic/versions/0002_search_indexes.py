"""Add performance indexes for search queries.

Revision ID: 0002
Revises: 0001
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Document search indexes
    op.create_index("ix_documents_original_filename", "documents", ["original_filename"])
    op.create_index("ix_documents_title", "documents", ["title"])
    op.create_index("ix_documents_author", "documents", ["author"])
    op.create_index("ix_documents_subject", "documents", ["subject"])
    op.create_index("ix_documents_status", "documents", ["status"])
    op.create_index("ix_documents_owner_id", "documents", ["owner_id"])
    op.create_index("ix_documents_created_at", "documents", ["created_at"])

    # Course search indexes
    op.create_index("ix_courses_name", "courses", ["name"])
    op.create_index("ix_courses_code", "courses", ["code"])
    op.create_index("ix_courses_professor", "courses", ["professor"])
    op.create_index("ix_courses_department", "courses", ["department"])

    # Message / conversation indexes
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])
    op.create_index("ix_conversations_updated_at", "conversations", ["updated_at"])

    # Chunk index
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_chunks_document_id")
    op.drop_index("ix_conversations_updated_at")
    op.drop_index("ix_conversations_user_id")
    op.drop_index("ix_messages_created_at")
    op.drop_index("ix_messages_conversation_id")
    op.drop_index("ix_courses_department")
    op.drop_index("ix_courses_professor")
    op.drop_index("ix_courses_code")
    op.drop_index("ix_courses_name")
    op.drop_index("ix_documents_created_at")
    op.drop_index("ix_documents_owner_id")
    op.drop_index("ix_documents_status")
    op.drop_index("ix_documents_subject")
    op.drop_index("ix_documents_author")
    op.drop_index("ix_documents_title")
    op.drop_index("ix_documents_original_filename")
