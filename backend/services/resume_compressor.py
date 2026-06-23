"""
Resume Compressor — section-aware truncation.
Always preserves education section.
"""
from __future__ import annotations
import re
from typing import Dict, List

DEFAULT_BUDGET = 3000

SECTION_PATTERNS: List[tuple] = [
    ("education", [
        r"education", r"academic\s+(?:background|qualifications?)",
        r"qualifications?", r"educational\s+background",
    ]),
    ("skills", [
        r"(?:technical\s+)?skills", r"core\s+competencies",
        r"technologies", r"tech\s+stack", r"expertise",
    ]),
    ("experience", [
        r"(?:work\s+|professional\s+|relevant\s+)?experience",
        r"employment(?:\s+history)?", r"work\s+history",
        r"career\s+(?:history|summary)",
    ]),
    ("summary", [
        r"summary", r"profile", r"objective",
        r"about\s+me", r"professional\s+summary",
    ]),
    ("projects", [r"projects?", r"key\s+projects?"]),
    ("certifications", [r"certifications?", r"courses?", r"training"]),
]


def _build_header_regex() -> re.Pattern:
    alternatives = []
    for _, patterns in SECTION_PATTERNS:
        alternatives.extend(patterns)
    joined = "|".join(alternatives)
    return re.compile(
        rf"^\s*(?:{joined})\s*[:\-–—]?\s*$",
        re.IGNORECASE | re.MULTILINE,
    )


_HEADER_RE = _build_header_regex()


def _classify(header_text: str) -> str:
    cleaned = header_text.strip().rstrip(":-–—").strip().lower()
    for label, patterns in SECTION_PATTERNS:
        for pat in patterns:
            if re.fullmatch(pat, cleaned, re.IGNORECASE):
                return label
    return "other"


def split_into_sections(resume_text: str) -> Dict[str, str]:
    sections: Dict[str, List[str]] = {}
    matches = list(_HEADER_RE.finditer(resume_text))

    if not matches:
        return {"other": resume_text.strip()}

    preamble = resume_text[:matches[0].start()].strip()
    if preamble:
        sections.setdefault("preamble", []).append(preamble)

    for i, m in enumerate(matches):
        label = _classify(m.group(0))
        body_start = m.end()
        body_end = matches[i+1].start() if i+1 < len(matches) else len(resume_text)
        body = resume_text[body_start:body_end].strip()
        if body:
            sections.setdefault(label, []).append(body)

    return {k: "\n\n".join(v).strip() for k, v in sections.items()}


def compress_resume(resume_text: str, budget: int = DEFAULT_BUDGET) -> str:
    text = resume_text.strip()
    if len(text) <= budget:
        return text

    sections = split_into_sections(text)
    priority = ["education", "skills", "experience", "summary",
                "projects", "certifications", "preamble", "other"]

    chunks: List[tuple] = []
    remaining = budget
    OVERHEAD = 20

    # Education first — always preserved
    edu = sections.get("education", "")
    if edu:
        if len(edu) >= budget - 300:
            edu_slice = edu[:budget-300].rstrip() + "\n[... education truncated ...]"
            chunks.append(("education", edu_slice))
            remaining = 300
        else:
            chunks.append(("education", edu))
            remaining = budget - len(edu)

    for label in priority:
        if label == "education":
            continue
        body = sections.get(label, "")
        if not body:
            continue
        slot = remaining - OVERHEAD
        if slot <= 50:
            break
        if len(body) <= slot:
            chunks.append((label, body))
            remaining -= len(body) + OVERHEAD
        else:
            chunks.append((label, body[:slot].rstrip() + f"\n[... {label} truncated ...]"))
            remaining -= slot + OVERHEAD
            break

    output_order = ["preamble","summary","skills","experience",
                    "projects","certifications","education","other"]
    chunk_map = dict(chunks)
    parts = []
    for label in output_order:
        if label not in chunk_map:
            continue
        if label == "preamble":
            parts.append(chunk_map[label])
        else:
            parts.append(f"\n\n=== {label.upper()} ===\n{chunk_map[label]}")

    return "".join(parts).strip()
