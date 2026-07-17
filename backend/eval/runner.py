"""Eval orchestrator — runs golden Q&A through the retrieval pipeline and computes metrics."""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.models.document import Chunk, Document
from app.retrieval.hybrid import retrieve
from .dataset import load_suites, EvalQuestion, EvalSuite
from .metrics import recall_at_k, mrr
from .faithfulness import score_faithfulness, score_correctness

logger = get_logger(__name__)


@dataclass
class EvalResult:
    question_id: str
    question: str
    retrieved_chunk_ids: list[str] = field(default_factory=list)
    relevant_chunk_ids: list[str] = field(default_factory=list)
    recall_at_5: float = 0.0
    mrr: float = 0.0
    faithfulness: float = 0.0
    correctness: float = 0.0
    latency_ms: float = 0.0
    error: Optional[str] = None


@dataclass
class EvalSummary:
    suite_name: str
    num_questions: int
    avg_recall_at_5: float
    avg_mrr: float
    avg_faithfulness: float
    avg_correctness: float
    avg_latency_ms: float
    results: list[EvalResult] = field(default_factory=list)
    questions_with_no_chunks: int = 0


async def _lookup_relevant_chunks(
    db: AsyncSession, q: EvalQuestion,
) -> tuple[set[str], list[str]]:
    """Find relevant chunk DB IDs for a question. Returns (set of chunk_ids, list of content previews)."""
    chunk_ids: set[str] = set()
    contents: list[str] = []

    # Strategy 1: match by document filename + chunk indices
    if q.document_filename and q.relevant_indices:
        doc_result = await db.execute(
            select(Document).where(Document.filename == q.document_filename)
        )
        doc = doc_result.scalar_one_or_none()
        if doc:
            chunk_result = await db.execute(
                select(Chunk).where(
                    Chunk.document_id == doc.id,
                    Chunk.chunk_index.in_(q.relevant_indices),
                )
            )
            for c in chunk_result.scalars().all():
                chunk_ids.add(c.id)
                contents.append(c.content)

    # Strategy 2: match by content prefix
    if q.relevant_content_prefixes and not chunk_ids:
        for prefix in q.relevant_content_prefixes:
            chunk_result = await db.execute(
                select(Chunk).where(Chunk.content.like(f"{prefix}%"))
            )
            for c in chunk_result.scalars().all():
                chunk_ids.add(c.id)
                contents.append(c.content)

    return chunk_ids, contents


async def run_question(
    q: EvalQuestion,
    db: AsyncSession,
    top_k: int = None,
) -> EvalResult:
    """Run a single eval question through the full retrieval pipeline."""
    result = EvalResult(question_id=q.id, question=q.question)

    try:
        # Look up relevant chunks in the DB
        relevant_ids, relevant_contents = await _lookup_relevant_chunks(db, q)
        result.relevant_chunk_ids = list(relevant_ids)

        if not relevant_ids:
            result.error = "No relevant chunks found in DB"
            return result

        # Run retrieval
        start = time.time()
        chunks = await retrieve(
            query=q.question,
            db=db,
            course_id=q.course_id if q.course_id else None,
            top_k=top_k,
            rerank=bool(settings.COHERE_API_KEY),
        )
        result.latency_ms = round((time.time() - start) * 1000, 2)

        retrieved_ids = [c.chunk_id for c in chunks]
        result.retrieved_chunk_ids = retrieved_ids

        # Compute metrics
        result.recall_at_5 = recall_at_k(retrieved_ids, relevant_ids, k=5)
        result.mrr = mrr(retrieved_ids, relevant_ids)

        # Faithfulness (requires generation)
        if chunks and retrieved_ids:
            from app.generation.generator import generate_answer
            gen = await generate_answer(query=q.question, chunks=chunks, mode="strict")
            context_texts = [c.content for c in chunks]

            faith_task = score_faithfulness(q.question, gen.answer, context_texts)
            correct_task = score_correctness(q.question, gen.answer, q.ground_truth) if q.ground_truth else None

            results = await asyncio.gather(faith_task, correct_task, return_exceptions=True)
            result.faithfulness = results[0] if not isinstance(results[0], Exception) else 0.0
            result.correctness = results[1] if len(results) > 1 and not isinstance(results[1], Exception) else 0.0

    except Exception as e:
        logger.error("Eval question failed", question_id=q.id, error=str(e))
        result.error = str(e)

    return result


async def run_eval(
    suite_name: Optional[str] = None,
    data_dir: Optional[Path] = None,
    top_k: int = None,
    verbose: bool = True,
) -> list[EvalSummary]:
    """Run all eval suites (or a specific one) and print summary."""
    suites = load_suites(data_dir)
    if suite_name:
        suites = [s for s in suites if s.name == suite_name]

    if not suites:
        logger.warning("No eval suites found", data_dir=str(data_dir or "default"))
        return []

    summaries = []
    async with AsyncSessionLocal() as db:
        for suite in suites:
            if verbose:
                print(f"\n{'='*60}")
                print(f"  Suite: {suite.name}")
                print(f"  {suite.description}")
                print(f"{'='*60}")

            results = await asyncio.gather(*[
                run_question(q, db, top_k) for q in suite.questions
            ])

            valid = [r for r in results if r.error is None or "No relevant chunks" not in (r.error or "")]
            no_chunks = sum(1 for r in results if r.error and "No relevant chunks" in r.error)

            summary = EvalSummary(
                suite_name=suite.name,
                num_questions=len(results),
                avg_recall_at_5=sum(r.recall_at_5 for r in valid) / max(len(valid), 1),
                avg_mrr=sum(r.mrr for r in valid) / max(len(valid), 1),
                avg_faithfulness=sum(r.faithfulness for r in valid) / max(len(valid), 1),
                avg_correctness=sum(r.correctness for r in valid) / max(len(valid), 1),
                avg_latency_ms=sum(r.latency_ms for r in valid) / max(len(valid), 1),
                results=results,
                questions_with_no_chunks=no_chunks,
            )
            summaries.append(summary)

            if verbose:
                print(f"  Questions: {summary.num_questions}")
                print(f"  recall@5:  {summary.avg_recall_at_5:.3f}")
                print(f"  MRR:       {summary.avg_mrr:.3f}")
                print(f"  Faith:     {summary.avg_faithfulness:.3f}")
                print(f"  Correct:   {summary.avg_correctness:.3f}")
                print(f"  Latency:   {summary.avg_latency_ms:.0f} ms")
                if no_chunks:
                    print(f"  WARNING: {no_chunks} questions had no matching chunks in DB")

    return summaries


async def main():
    """CLI entry point: python -m eval.runner"""
    import argparse
    parser = argparse.ArgumentParser(description="RAG Eval Harness")
    parser.add_argument("--suite", help="Run only this suite name")
    parser.add_argument("--data-dir", default=None, help="Path to YAML data directory")
    parser.add_argument("--top-k", type=int, default=None, help="Override top_k for retrieval")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    summaries = await run_eval(
        suite_name=args.suite,
        data_dir=Path(args.data_dir) if args.data_dir else None,
        top_k=args.top_k,
        verbose=not args.json,
    )

    if args.json:
        results = []
        for s in summaries:
            results.append({
                "suite": s.suite_name,
                "num_questions": s.num_questions,
                "avg_recall_at_5": s.avg_recall_at_5,
                "avg_mrr": s.avg_mrr,
                "avg_faithfulness": s.avg_faithfulness,
                "avg_correctness": s.avg_correctness,
                "avg_latency_ms": s.avg_latency_ms,
            })
        print(json.dumps(results, indent=2))

    return summaries


if __name__ == "__main__":
    asyncio.run(main())
