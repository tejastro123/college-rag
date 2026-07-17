"""Golden Q&A dataset definitions."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

EVAL_DATA_DIR = Path(__file__).parent / "data"


@dataclass
class EvalQuestion:
    id: str
    question: str
    ground_truth: str
    course_id: str

    # How to identify relevant chunks at eval time
    document_filename: Optional[str] = None
    relevant_indices: list[int] = field(default_factory=list)

    # Fallback: match chunks by content prefix
    relevant_content_prefixes: list[str] = field(default_factory=list)

    metadata: dict = field(default_factory=dict)


@dataclass
class EvalSuite:
    name: str
    description: str = ""
    questions: list[EvalQuestion] = field(default_factory=list)


def load_suites(data_dir: Optional[Path] = None) -> list[EvalSuite]:
    """Load all golden datasets from YAML files in data_dir."""
    data_dir = data_dir or EVAL_DATA_DIR
    if not data_dir.exists():
        return []

    suites = []
    for path in sorted(data_dir.glob("*.yaml")):
        with open(path) as f:
            raw = yaml.safe_load(f)
        if not raw:
            continue

        questions = []
        for q in raw.get("questions", []):
            questions.append(EvalQuestion(
                id=q.get("id", ""),
                question=q["question"],
                ground_truth=q.get("ground_truth", ""),
                course_id=q.get("course_id", ""),
                document_filename=q.get("document"),
                relevant_indices=q.get("relevant_indices", []),
                relevant_content_prefixes=q.get("relevant_content_prefixes", []),
                metadata=q.get("metadata", {}),
            ))

        suites.append(EvalSuite(
            name=raw.get("name", path.stem),
            description=raw.get("description", ""),
            questions=questions,
        ))

    return suites
