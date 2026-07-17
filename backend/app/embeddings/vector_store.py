"""Vector store abstraction using ChromaDB."""
from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_vector_store_instance = None


class VectorStore:
    def __init__(self, client, collection):
        self._client = client
        self._collection = collection

    async def add_documents(
        self,
        texts: List[str],
        ids: List[str],
        metadatas: List[dict],
    ) -> None:
        if not texts:
            return
        # ChromaDB handles embedding internally via the embedding function
        self._collection.upsert(
            documents=texts,
            ids=ids,
            metadatas=metadatas,
        )
        logger.info("Vectors upserted", count=len(texts))

    async def search(
        self,
        query: str,
        n_results: int = 10,
        where: Optional[dict] = None,
    ) -> list[dict]:
        kwargs = {"query_texts": [query], "n_results": n_results}
        if where:
            kwargs["where"] = where
        try:
            results = self._collection.query(**kwargs)
        except Exception as e:
            logger.error("Vector search failed", error=str(e))
            return []

        hits = []
        if results and results["ids"]:
            for i, (rid, doc, dist, meta) in enumerate(zip(
                results["ids"][0],
                results["documents"][0],
                results["distances"][0],
                results["metadatas"][0],
            )):
                hits.append({
                    "id": rid,
                    "content": doc,
                    "score": 1 - dist,  # cosine distance → similarity
                    "rank": i + 1,
                    "metadata": meta or {},
                })
        return hits

    async def delete_document(self, document_id: str) -> None:
        try:
            results = self._collection.get(where={"document_id": document_id})
            if results and results["ids"]:
                self._collection.delete(ids=results["ids"])
                logger.info("Vectors deleted", document_id=document_id, count=len(results["ids"]))
        except Exception as e:
            logger.error("Vector delete failed", error=str(e))

    def get_collection_stats(self) -> dict:
        try:
            count = self._collection.count()
            return {"total_vectors": count}
        except Exception:
            return {"total_vectors": 0}


async def get_vector_store() -> VectorStore:
    global _vector_store_instance
    if _vector_store_instance is not None:
        return _vector_store_instance

    try:
        import chromadb

        persist_dir = Path(settings.CHROMA_PERSIST_DIR)
        persist_dir.mkdir(parents=True, exist_ok=True)

        client = chromadb.PersistentClient(path=str(persist_dir))

        from app.embeddings.provider import EmbeddingFunctionProvider
        ef = EmbeddingFunctionProvider()

        collection = client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )

        _vector_store_instance = VectorStore(client, collection)
        logger.info("Vector store initialized", collection=settings.CHROMA_COLLECTION_NAME)
        return _vector_store_instance

    except Exception as e:
        logger.error("Vector store initialization failed", error=str(e))
        raise
