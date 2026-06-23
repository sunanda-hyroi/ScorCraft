from __future__ import annotations
import re
from datetime import datetime
from typing import List, Tuple, Optional

_CURRENT = {"present","current","now","till date","to date","ongoing"}
_MONTH_MAP = {
    "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
    "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12,
    "january":1,"february":2,"march":3,"april":4,"june":6,
    "july":7,"august":8,"september":9,"october":10,
    "november":11,"december":12,
}

def _parse_date(token: str) -> Optional[datetime]:
    t = token.strip().lower()
    if t in _CURRENT:
        return datetime.now()
    # "Mar-2022" or "Mar 2022"
    m = re.match(r"(\w{3})[-\s](\d{4})", t)
    if m:
        month = _MONTH_MAP.get(m.group(1).lower())
        if month:
            return datetime(int(m.group(2)), month, 1)
    # "January 2022"
    m = re.match(r"(\w+)\s+(\d{4})", t)
    if m:
        month = _MONTH_MAP.get(m.group(1).lower())
        if month:
            return datetime(int(m.group(2)), month, 1)
    # "2022"
    m = re.match(r"^(\d{4})$", t)
    if m:
        return datetime(int(m.group(1)), 1, 1)
    return None

def _extract_tenures(resume_text: str) -> List[float]:
    text = resume_text.lower()
    tenures = []
    patterns = [
        r"(\w+\s+\d{4})\s*[–\-—to]+\s*(\w+(?:\s+\d{4})?)",
        r"\b(\d{4})\s*[–\-—to]+\s*(\d{4}|present|current|now)\b",
    ]
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            g = m.groups()
            try:
                start = _parse_date(g[0])
                end   = _parse_date(g[1])
                if start and end and start < end:
                    yrs = (end - start).days / 365.25
                    if 0.1 < yrs < 20:
                        tenures.append(round(yrs, 1))
            except (ValueError, TypeError):
                continue
    return tenures

def score_stability(resume_text: str) -> dict:
    tenures = _extract_tenures(resume_text)

    if not tenures:
        return {
            "score": 60,
            "reasoning": "Employment timeline could not be determined from resume dates.",
            "avg_tenure": None,
            "roles_count": 0,
        }

    avg = round(sum(tenures) / len(tenures), 1)
    roles = len(tenures)

    if avg >= 3.0:   score, label = 100, "excellent"
    elif avg >= 2.0: score, label = 85,  "good"
    elif avg >= 1.5: score, label = 70,  "acceptable"
    elif avg >= 1.0: score, label = 50,  "below average"
    else:            score, label = 25,  "concerning"

    if roles >= 4 and avg >= 2.0:
        score = min(100, score + 5)

    short = sum(1 for t in tenures if t < 1.0)
    if short > roles / 2:
        score = max(20, score - 15)

    reasoning = f"Average tenure of {avg} years across {roles} role(s) — {label} stability."
    if short > 0:
        reasoning += f" {short} role(s) under 1 year detected."

    return {
        "score": max(0, min(100, score)),
        "reasoning": reasoning,
        "avg_tenure": avg,
        "roles_count": roles,
    }
