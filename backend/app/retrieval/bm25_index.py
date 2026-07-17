"""Persistent BM25 index built from all chunks at ingestion time."""
from __future__ import annotations

import pickle
import re
from pathlib import Path
from typing import Optional

import numpy as np
from rank_bm25 import BM25Okapi

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class BM25Index:
    def __init__(self):
        self.index_dir = Path(settings.BM25_INDEX_DIR)
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.bm25: Optional[BM25Okapi] = None
        self.documents: list[dict] = []
        self._index_path = self.index_dir / "bm25_index.pkl"
        self._docs_path = self.index_dir / "bm25_docs.pkl"

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"\b\w+\b", text.lower())

    def build(self, documents: list[dict]):
        self.documents = documents
        corpus = [self._tokenize(d["content"]) for d in documents]
        self.bm25 = BM25Okapi(corpus)
        self._save()
        logger.info("BM25 index built", docs=len(documents))

    def add(self, documents: list[dict]):
        self.documents.extend(documents)
        corpus = [self._tokenize(d["content"]) for d in self.documents]
        self.bm25 = BM25Okapi(corpus)
        self._save()

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        if self.bm25 is None:
            if not self._load():
                return []

        tokenized = self._tokenize(query)
        scores = self.bm25.get_scores(tokenized)
        top_indices = np.argsort(scores)[-top_k:][::-1]

        results = []
        for idx in top_indices:
            if scores[idx] > 0:
                doc = self.documents[idx]
                results.append({
                    "id": doc["id"],
                    "content": doc["content"],
                    "score": float(scores[idx]),
                    "metadata": doc.get("metadata", {}),
                })
        return results

    def _save(self):
        with open(self._index_path, "wb") as f:
            pickle.dump(self.bm25, f)
        with open(self._docs_path, "wb") as f:
            pickle.dump(self.documents, f)

    def _load(self) -> bool:
        if not (self._index_path.exists() and self._docs_path.exists()):
            return False
        try:
            with open(self._index_path, "rb") as f:
                self.bm25 = pickle.load(f)
            with open(self._docs_path, "rb") as f:
                self.documents = pickle.load(f)
            logger.info("BM25 index loaded", docs=len(self.documents))
            return True
        except Exception as e:
            logger.error("Failed to load BM25 index", error=str(e))
            return False

    @property
    def is_loaded(self) -> bool:
        return self.bm25 is not None


_index: Optional[BM25Index] = None


def get_bm25_index() -> BM25Index:
    global _index
    if _index is None:
        _index = BM25Index()
    return _index


async def rebuild_index_from_db(db):
    from app.models.document import Chunk
    from sqlalchemy import select

    result = await db.execute(select(Chunk))
    chunks = result.scalars().all()

    documents = []
    for c in chunks:
        meta = c.meta or {}
        documents.append({
            "id": c.id,
            "content": c.content,
            "metadata": {
                "document_id": c.document_id,
                "chunk_id": c.id,
                "page_number": c.page_number,
                "section": c.section,
                "heading": c.heading,
                "chunk_type": c.chunk_type,
                **meta,
            },
        })

    index = get_bm25_index()
    index.build(documents)
    logger.info("BM25 index rebuilt from DB", chunks=len(documents))
