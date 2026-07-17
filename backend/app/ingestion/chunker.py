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


def _recursive_split(text: str, chunk_size: int, overlap: int, separators: list[str] = None) -> list[str]:
    """
    Recursive character text splitter.
    Tries each separator in order: paragraphs → newlines → sentences → words.
    Produces overlapping chunks.
    """
    if separators is None:
        separators = ["\n\n", "\n", ". ", " "]

    if len(text) <= chunk_size:
        return [text]

    separator = separators[0]
    remaining_seps = separators[1:]

    # Try current separator
    if separator == " ":
        # Word-level fallback: split by spaces, merge at chunk_size
        words = text.split()
        chunks = []
        current = []
        current_len = 0
        for w in words:
            wlen = len(w) + 1  # +1 for space
            if current_len + wlen > chunk_size and current:
                chunk_str = " ".join(current)
                chunks.append(chunk_str)
                # overlap: keep last words up to overlap chars
                overlap_words = []
                ol = 0
                for ow in reversed(current):
                    ol += len(ow) + 1
                    if ol > overlap:
                        break
                    overlap_words.insert(0, ow)
                current = overlap_words
                current_len = sum(len(w) + 1 for w in overlap_words) if overlap_words else 0
            current.append(w)
            current_len += wlen
        if current:
            chunks.append(" ".join(current))
        return chunks

    # Split by the current separator
    parts = text.split(separator)
    if len(parts) == 1:
        # Separator not found, try next
        return _recursive_split(text, chunk_size, overlap, remaining_seps)

    # Merge parts into chunks
    merged = []
    current = []
    current_len = 0
    sep_len = len(separator)

    for part in parts:
        part = part.strip()
        if not part:
            continue
        part_len = len(part) + sep_len
        if current_len + part_len > chunk_size and current:
            merged.append(separator.join(current))
            # overlap: keep trailing text up to overlap chars
            overlap_text = ""
            if overlap > 0:
                combined = separator.join(current)
                overlap_text = combined[-overlap:] if len(combined) > overlap else combined
            current = [overlap_text] if overlap_text else []
            current_len = len(overlap_text)
        current.append(part)
        current_len += part_len

    if current:
        merged.append(separator.join(current))

    # Still oversize? Recurse with next separator
    result = []
    for m in merged:
        if len(m) > chunk_size and remaining_seps:
            result.extend(_recursive_split(m, chunk_size, overlap, remaining_seps))
        else:
            result.append(m)
    return result


def _estimate_gist(text: str, max_len: int = 100) -> str:
    """Extract a short gist from the chunk text."""
    first = text.strip().split("\n")[0][:max_len]
    if len(text) <= max_len:
        return text
    return first.rstrip(". ") + "..."


def _extract_keywords(text: str, max_kw: int = 5) -> list[str]:
    """Simple keyword extraction: TF-ish frequency of capitalised / long words."""
    words = re.findall(r"[A-Z][a-z]{3,}", text)
    freq = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    ranked = sorted(freq, key=freq.get, reverse=True)
    return ranked[:max_kw]


def chunk_document(
    pages: list[dict],
    chunk_size: int = None,
    chunk_overlap: int = None,
    doc_metadata: dict = None,
    strategy: str = None,
) -> list[TextChunk]:
    """
    Hierarchical chunking with recursive splitter:
    document → sections (by headings) → paragraphs → sentences → words
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
    doc_metadata = doc_metadata or {}
    strategy = strategy or getattr(settings, "CHUNKING_STRATEGY", "hierarchical")
    chunks: list[TextChunk] = []
    idx = 0
    current_section = ""

    # Pre-compute total text length across all pages for position tracking
    total_text_len = sum(len(p.get("text", "")) for p in pages) or 1
    text_so_far = 0

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
                chunk = TextChunk(
                    content=table_text,
                    chunk_index=idx,
                    chunk_type="table",
                    page_number=page_num,
                    section=current_section or None,
                    token_count=_count_tokens(table_text),
                    char_count=len(table_text),
                    metadata={**doc_metadata, "position": 0.0, "gist": _estimate_gist(table_text)},
                )
                chunks.append(chunk)
                idx += 1

        # Split page text by headings
        sections = _split_by_headings(page_text)

        for heading, section_content in sections:
            if heading:
                current_section = heading

            if len(section_content.strip()) < 30:
                continue

            # Detect formulas
            formula_pattern = re.compile(r"(\$\$.+?\$\$|\$.+?\$|\\begin\{.+?\}.*?\\end\{.+?\})", re.DOTALL)
            formula_matches = list(formula_pattern.finditer(section_content))

            # Chunk the content
            if strategy == "recursive" and len(section_content) > chunk_size:
                sub_chunks = _recursive_split(section_content, chunk_size, chunk_overlap)
            elif len(section_content) > chunk_size:
                sub_chunks = _recursive_split(section_content, chunk_size, chunk_overlap)
            else:
                sub_chunks = [section_content]

            for sub in sub_chunks:
                sub = sub.strip()
                if len(sub) < 20:
                    continue
                ctype = _detect_chunk_type(sub)
                position = round(text_so_far / total_text_len, 3)
                enriched_meta = {
                    **doc_metadata,
                    "position": position,
                    "gist": _estimate_gist(sub),
                    **({"keywords": _extract_keywords(sub)} if len(sub) > 200 else {}),
                }
                chunks.append(TextChunk(
                    content=sub,
                    chunk_index=idx,
                    chunk_type=ctype,
                    page_number=page_num,
                    section=current_section or None,
                    heading=heading if heading else None,
                    token_count=_count_tokens(sub),
                    char_count=len(sub),
                    metadata=enriched_meta,
                ))
                idx += 1
                text_so_far += len(sub)

    logger.info("Chunking complete", total_chunks=len(chunks), strategy=strategy)
    return chunks
