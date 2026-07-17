"""Prometheus metrics for RAG observability."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from prometheus_client import Counter, Histogram, Gauge, generate_latest, REGISTRY

# ── RAG pipeline metrics ──────────────────────────────────

rag_queries_total = Counter(
    "rag_queries_total",
    "Total number of RAG queries",
    labelnames=["course_id", "mode", "retrieval_type"],
)

rag_latency_seconds = Histogram(
    "rag_latency_seconds",
    "RAG query latency in seconds",
    labelnames=["course_id", "mode"],
    buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, float("inf")),
)

rag_confidence = Histogram(
    "rag_confidence",
    "Confidence score distribution",
    labelnames=["course_id"],
    buckets=(0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
)

rag_tokens_total = Counter(
    "rag_tokens_total",
    "Total tokens used (prompt + completion)",
    labelnames=["course_id"],
)

rag_retrieval_failures_total = Counter(
    "rag_retrieval_failures_total",
    "Number of retrieval attempts that returned zero chunks",
    labelnames=["course_id"],
)

rag_chunks_retrieved = Histogram(
    "rag_chunks_retrieved",
    "Number of chunks retrieved per query",
    labelnames=["course_id"],
    buckets=(0, 1, 3, 5, 8, 10, 15, 20, float("inf")),
)


@dataclass
class RAGMetrics:
    """Snapshot of metrics to record after each RAG query."""
    course_id: str = ""
    mode: str = "normal"
    retrieval_type: str = "single"
    latency_ms: float = 0.0
    confidence: float = 0.0
    tokens_used: int = 0
    chunks_retrieved: int = 0
    retrieval_success: bool = True
    error: Optional[str] = None


def record_rag_metrics(m: RAGMetrics) -> None:
    """Record all metrics from a RAGMetrics snapshot."""
    labels_course = [m.course_id or "none"]
    labels_query = [m.course_id or "none", m.mode, m.retrieval_type]

    rag_queries_total.labels(*labels_query).inc()

    if not m.retrieval_success or m.chunks_retrieved == 0:
        rag_retrieval_failures_total.labels(*labels_course).inc()

    if m.latency_ms > 0:
        rag_latency_seconds.labels(m.course_id or "none", m.mode).observe(m.latency_ms / 1000.0)

    rag_confidence.labels(*labels_course).observe(m.confidence)

    if m.tokens_used > 0:
        rag_tokens_total.labels(*labels_course).inc(m.tokens_used)

    rag_chunks_retrieved.labels(*labels_course).observe(m.chunks_retrieved)
