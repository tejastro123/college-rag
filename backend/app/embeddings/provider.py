"""
Pluggable embedding provider with automatic fallback.
Supports: ollama (default), sentence-transformers, auto (try ollama → fallback)
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_ST = None  # lazy import cache


def _get_sentence_transformer(model_name: str):
    global _ST
    if _ST is None:
        from sentence_transformers import SentenceTransformer
        _ST = SentenceTransformer(model_name, cache_folder=str(Path(settings.SENTENCE_TRANSFORMERS_CACHE)))
        logger.info("SentenceTransformer model loaded", model=model_name)
    return _ST


class _OllamaEF:
    """Wrapper around chromadb's OllamaEmbeddingFunction."""
    def __init__(self):
        import chromadb.utils.embedding_functions as ef
        self._fn = ef.OllamaEmbeddingFunction(
            url=f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/embeddings",
            model_name=settings.OLLAMA_EMBEDDING_MODEL,
        )

    def embed_query(self, input: list[str]) -> list[list[float]]:
        return self._fn.embed_query(input)

    def __call__(self, input: list[str]) -> list[list[float]]:
        return self._fn(input)


class _SentenceTransformerEF:
    """Sentence-transformers local embedding function."""
    def __init__(self, model_name: Optional[str] = None):
        self._model_name = model_name or settings.SENTENCE_TRANSFORMERS_MODEL

    def embed_query(self, input: list[str]) -> list[list[float]]:
        return self.__call__(input)

    def __call__(self, input: list[str]) -> list[list[float]]:
        model = _get_sentence_transformer(self._model_name)
        embeddings = model.encode(input, show_progress_bar=False)
        return embeddings.tolist()


class EmbeddingFunctionProvider:
    """ChromaDB-compatible embedding function with fallback.

    Provider modes:
      - "ollama": use Ollama embedding API only
      - "sentence-transformers": use local sentence-transformers only
      - "auto": try Ollama first, fall back to sentence-transformers on failure
    """
    def __init__(self):
        self._primary: Optional[_OllamaEF] = None
        self._fallback: Optional[_SentenceTransformerEF] = None
        self._active: Optional = None
        self._initialized = False
        self._name = self.__class__.__name__

    def _try_init_ollama(self) -> Optional[_OllamaEF]:
        try:
            ef = _OllamaEF()
            ef(["test"])  # probe call
            logger.info("Ollama embedding available")
            return ef
        except Exception as e:
            logger.warning("Ollama embedding unavailable", error=str(e))
            return None

    def _init_sentence_transformers(self) -> _SentenceTransformerEF:
        logger.info("Initializing sentence-transformers fallback")
        return _SentenceTransformerEF()

    def _init(self):
        if self._initialized:
            return

        provider = settings.EMBEDDING_PROVIDER

        if provider in ("sentence-transformers", "sentence_transformers"):
            self._active = self._init_sentence_transformers()

        elif provider == "ollama":
            self._active = self._try_init_ollama()
            if self._active is None:
                raise RuntimeError(
                    "Ollama embedding unreachable. Set EMBEDDING_PROVIDER=sentence-transformers or ensure Ollama is running."
                )

        else:  # "auto"
            self._primary = self._try_init_ollama()
            self._fallback = self._init_sentence_transformers()
            self._active = self._primary or self._fallback

        self._initialized = True
        logger.info("Embedding provider ready", provider=type(self._active).__name__)

    def name(self) -> str:
        return self._name

    def embed_query(self, input: list[str]) -> list[list[float]]:
        """ChromaDB query-time embedding — delegates to __call__."""
        return self.__call__(input)

    def __call__(self, input: list[str]) -> list[list[float]]:
        self._init()
        try:
            return self._active(input)
        except Exception as exc:
            # Fallback at call-time: primary failed → switch to fallback permanently
            if self._active is self._primary and self._fallback is not None:
                logger.warning("Embedding primary failed, switching to fallback")
                self._active = self._fallback
                return self._active(input)
            raise exc
