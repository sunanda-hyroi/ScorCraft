"""
Education Scorer - hierarchy matching.
Same level or higher = 100%. No score if not found or not specified.
"""
from __future__ import annotations
import re

DEGREE_LEVELS = {
    1: ["high school", "hsc", "ssc", "10th", "12th", "secondary", "higher secondary", "intermediate"],
    2: ["diploma", "iti", "polytechnic", "vocational"],
    3: [
        "bachelor", "b.tech", "b.e", "be", "bsc", "b.sc", "bca", "bba",
        "ba", "b.a", "bcom", "b.com", "beng", "b.eng", "b.arch",
        "graduation", "graduate", "undergraduate", "ug",
        "bachelor of technology", "bachelor of engineering",
        "bachelor of science", "bachelor of arts", "bachelor of commerce",
    ],
    4: [
        "master", "m.tech", "me", "m.e", "msc", "m.sc", "mba",
        "mca", "ma", "m.a", "mcom", "m.com", "meng", "m.eng",
        "postgraduate", "post graduate", "pg", "post-graduate",
        "master of technology", "master of engineering",
        "master of science", "master of business administration",
    ],
    5: ["phd", "ph.d", "doctorate", "doctoral", "dphil", "d.phil"],
}

_KEYWORD_LEVEL: dict[str, int] = {}
for level, keywords in DEGREE_LEVELS.items():
    for kw in keywords:
        _KEYWORD_LEVEL[kw.lower()] = level


def _detect_level(text: str) -> tuple[int, str]:
    text_lower = text.lower()
    best_level = 0
    best_kw    = ""
    for kw in sorted(_KEYWORD_LEVEL.keys(), key=len, reverse=True):
        if kw in text_lower:
            level = _KEYWORD_LEVEL[kw]
            if level > best_level:
                best_level = level
                best_kw    = kw
    return best_level, best_kw


def _detect_certifications(text: str) -> list[str]:
    patterns = [
        r"microsoft\s+certified\s+[\w\s]{2,30}",
        r"certified\s+[\w\s]{2,20}(?:associate|professional|expert|developer|analyst)",
        r"\b(?:aws|azure|gcp|pmp|cfa|cpa|cissp|comptia)\s+[\w\s]{2,20}",
        r"certification[s]?\s+in\s+[\w\s]{2,20}",
    ]
    found = []
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            cert = m.group(0).strip()
            if len(cert) > 5 and cert not in found:
                found.append(cert)
    return found[:5]


def score_education(resume_text: str, education_required: str = "") -> dict:
    certs = _detect_certifications(resume_text)

    # Not specified in JD
    if not education_required or education_required.strip().lower() in (
        "", "not specified", "none", "not required"
    ):
        return {
            "score":     None,
            "reasoning": "Not specified for this role.",
            "certifications": certs,
        }

    required_level, required_kw = _detect_level(education_required)
    if required_level == 0:
        return {
            "score":     None,
            "reasoning": "Not specified for this role.",
            "certifications": certs,
        }

    found_level, found_kw = _detect_level(resume_text)

    # No degree found in resume
    if found_level == 0:
        return {
            "score":     None,
            "reasoning": "No educational qualification found in this resume.",
            "certifications": certs,
        }

    gap = required_level - found_level

    if gap <= 0:
        # Meets or exceeds requirement
        if found_level > required_level:
            reasoning = (
                f"Candidate has {found_kw.upper()} which exceeds "
                f"the {education_required} requirement."
            )
        else:
            reasoning = (
                f"Candidate has {found_kw.upper()} which meets "
                f"the {education_required} requirement."
            )
        score = 100
    elif gap == 1:
        score     = 55
        reasoning = (
            f"Candidate has {found_kw.upper()}, one level below "
            f"the {education_required} requirement."
        )
    else:
        score     = 25
        reasoning = (
            f"Candidate has {found_kw.upper()}, below "
            f"the {education_required} requirement."
        )

    return {
        "score":          score,
        "reasoning":      reasoning,
        "certifications": certs,
    }
