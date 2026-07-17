"""Semantic chunking with hierarchy-aware splitting."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class TextChunk:
    content: str
    chunk_index: int
    chunk_type: str = "text"  # text|table|formula|code|heading
    page_number: Optional[int] = None
    section: Optional[str] = None
    heading: Optional[str] = None
    token_count: int = 0
    char_count: int = 0
    metadata: dict = field(default_factory=dict)


def _count_tokens(text: str) -> int:
    """Approximate token count (4 chars ≈ 1 token)."""
    return max(1, len(text) // 4)


def _detect_chunk_type(text: str) -> str:
    if re.search(r"[\$\\](begin|end|frac|sum|int|alpha|beta|gamma|theta)", text):
        return "formula"
    if text.strip().startswith("|") and "|" in text:
        return "table"
    if re.match(r"```|~~~|def |class |import |function ", text.strip()):
        return "code"
    return "text"


def _split_by_headings(text: str) -> list[tuple[str, str]]:
    """Split text into (heading, content) pairs based on markdown or numbered headings."""
    sections = []
    pattern = re.compile(
        r"^(#{1,6}\s.+|[A-Z][A-Z\s]{3,}|(?:\d+\.)+\s+.{3,}|Chapter\s+\d+.*)$",
        re.MULTILINE,
    )
    matches = list(pattern.finditer(text))
    if not matches:
        return [("", text)]

    for i, m in enumerate(matches):
        heading = m.group(0).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if content:
            sections.append((heading, content))
    return sections if sections else [("", text)]


def _split_by_size(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split long text into overlapping chunks by sentence boundaries."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks = []
    current = []
    current_len = 0

    for sent in sentences:
        sent_len = len(sent)
        if current_len + sent_len > chunk_size and current:
            chunks.append(" ".join(current))
            # overlap: keep last N chars worth of sentences
            overlap_text = " ".join(current)[-overlap:]
            current = [overlap_text] if overlap_text else []
            current_len = len(overlap_text)
        current.append(sent)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current))
    return chunks


def chunk_document(
    pages: list[dict],
    chunk_size: int = None,
    chunk_overlap: int = None,
    doc_metadata: dict = None,
) -> list[TextChunk]:
    """
    Hierarchical chunking:
    document → sections (by headings) → paragraphs → sentences
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
    doc_metadata = doc_metadata or {}
    chunks: list[TextChunk] = []
    idx = 0
    current_section = ""

    for page_info in pages:
        page_num = page_info.get("page_num", 1)
        page_text = page_info.get("text", "")
        tables = page_info.get("tables", [])

        # Handle tables as dedicated chunks
        for table in tables:
            if not table:
                continue
            table_rows = []
            for row in table:
                row_cells = [str(c or "").strip() for c in row]
                table_rows.append(" | ".join(row_cells))
            table_text = "\n".join(table_rows)
            if table_text.strip():
                chunks.append(TextChunk(
                    content=table_text,
                    chunk_index=idx,
                    chunk_type="table",
                    page_number=page_num,
                    section=current_section,
                    token_count=_count_tokens(table_text),
                    char_count=len(table_text),
                    metadata=doc_metadata,
                ))
                idx += 1

        # Split page text by headings
        sections = _split_by_headings(page_text)

        for heading, section_content in sections:
            if heading:
                current_section = heading

            # Skip tiny content
            if len(section_content.strip()) < 30:
                continue

            # Detect formulas first
            formula_pattern = re.compile(r"(\$\$.+?\$\$|\$.+?\$|\\begin\{.+?\}.*?\\end\{.+?\})", re.DOTALL)
            formula_matches = list(formula_pattern.finditer(section_content))

            # If section fits in one chunk, keep it whole
            if len(section_content) <= chunk_size:
                ctype = _detect_chunk_type(section_content)
                chunks.append(TextChunk(
                    content=section_content.strip(),
                    chunk_index=idx,
                    chunk_type=ctype,
                    page_number=page_num,
                    section=current_section,
                    heading=heading if heading else None,
                    token_count=_count_tokens(section_content),
                    char_count=len(section_content),
                    metadata=doc_metadata,
                ))
                idx += 1
            else:
                # Split large sections
                sub_chunks = _split_by_size(section_content, chunk_size, chunk_overlap)
                for sub in sub_chunks:
                    if len(sub.strip()) < 20:
                        continue
                    ctype = _detect_chunk_type(sub)
                    chunks.append(TextChunk(
                        content=sub.strip(),
                        chunk_index=idx,
                        chunk_type=ctype,
                        page_number=page_num,
                        section=current_section,
                        heading=heading if heading else None,
                        token_count=_count_tokens(sub),
                        char_count=len(sub),
                        metadata=doc_metadata,
                    ))
                    idx += 1

    logger.info("Chunking complete", total_chunks=len(chunks))
    return chunks
