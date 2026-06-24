"""
Experience Scorer - simple linear calculation.
score = min(100, round(candidate_years / required_years * 100))
100% when no requirement set.
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Optional, List, Tuple

_MONTH_MAP = {
    "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
    "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12,
    "january":1,"february":2,"march":3,"april":4,"june":6,
    "july":7,"august":8,"september":9,"october":10,
    "november":11,"december":12,
}
_CURRENT = {"present","current","now","till date","to date","ongoing","till now","todate"}

_PATTERNS = [
    # "from Mar-2022 to Till Date"
    r"from\s+(\w{3}[-\s]\d{4})\s+to\s+(\w+(?:[-\s]\d{4})?)",
    # "Mar-2022 to Present" or "Mar 2022 - Present"
    r"(\w{3}[-\s]\d{4})\s*(?:to|[-–—])\s*(\w+(?:[-\s]\d{4})?)",
    # "August 2020 to March 2022"
    r"(\w+\s+\d{4})\s+to\s+(\w+\s+\d{4})",
    # "January 2022 – Present"
    r"(\w+\s+\d{4})\s*[–\-—]+\s*(\w+(?:\s+\d{4})?)",
    # "2020 – 2023"
    r"\b(\d{4})\s*[–\-—to]+\s*(\d{4}|present|current|now)\b",
    # "01/2020 – 06/2023"
    r"(\d{1,2})[/\-](\d{4})\s*[–\-—]+\s*(\d{1,2})[/\-](\d{4})",
]


def _parse_date(token: str) -> Optional[datetime]:
    t = token.strip().lower().rstrip('.')
    if t in _CURRENT:
        return datetime.now()
    # "Mar-2022" or "Mar 2022"
    m = re.match(r"(\w{3})[-\s](\d{4})$", t)
    if m:
        month = _MONTH_MAP.get(m.group(1))
        if month:
            return datetime(int(m.group(2)), month, 1)
    # "January 2022" or "August 2020"
    m = re.match(r"(\w+)\s+(\d{4})$", t)
    if m:
        month = _MONTH_MAP.get(m.group(1)[:3])
        if month:
            return datetime(int(m.group(2)), month, 1)
    # "2022"
    m = re.match(r"^(\d{4})$", t)
    if m:
        return datetime(int(m.group(1)), 1, 1)
    return None


def extract_experience_years(resume_text: str) -> float:
    text = resume_text.lower()
    ranges: List[Tuple[datetime, datetime]] = []

    for pattern in _PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            g = m.groups()
            try:
                if len(g) == 2:
                    start = _parse_date(g[0])
                    end   = _parse_date(g[1])
                elif len(g) == 4:
                    start = _parse_date(f"{g[0]}/{g[1]}")
                    end   = _parse_date(f"{g[2]}/{g[3]}")
                else:
                    continue
                if start and end and start < end:
                    yrs = (end - start).days / 365.25
                    if 0.1 < yrs <= 25:
                        ranges.append((start, end))
            except (ValueError, TypeError):
                continue

    if not ranges:
        # Fallback: look for "X years of experience"
        for m in re.finditer(
            r"(\d+(?:\.\d+)?)\s*\+?\s*years?\s+(?:of\s+)?(?:experience|exp)",
            text, re.IGNORECASE
        ):
            try:
                return float(m.group(1))
            except ValueError:
                pass
        return 0.0

    # Merge overlapping ranges
    ranges.sort(key=lambda r: r[0])
    merged = [ranges[0]]
    for s, e in ranges[1:]:
        ls, le = merged[-1]
        if s <= le:
            merged[-1] = (ls, max(le, e))
        else:
            merged.append((s, e))

    return round(sum((e - s).days for s, e in merged) / 365.25, 1)


def score_experience(
    resume_text: str,
    exp_min: int = 0,
    exp_max: int = 0,
) -> dict:
    required = exp_min or exp_max

    # No requirement set → 100% for everyone
    if not required:
        return {
            "score":     100,
            "years":     extract_experience_years(resume_text) or None,
            "required":  None,
            "reasoning": "No experience requirement set for this role.",
        }

    years = extract_experience_years(resume_text)

    # Dates not parseable
    if years == 0:
        # Try to find a years mention
        return {
            "score":     None,
            "years":     None,
            "required":  required,
            "reasoning": "Experience duration could not be determined from this resume.",
        }

    score = min(100, round(years / required * 100))

    if years >= required:
        reasoning = (
            f"{years} years of experience — meets the "
            f"{required} year requirement."
        )
    elif score >= 80:
        reasoning = (
            f"{years} years of experience — slightly below the "
            f"{required} year requirement ({score}% match)."
        )
    else:
        reasoning = (
            f"{years} years of experience — below the "
            f"{required} year requirement ({score}% match)."
        )

    return {
        "score":     score,
        "years":     years,
        "required":  required,
        "reasoning": reasoning,
    }
