from __future__ import annotations
import re
from typing import Dict, List
from services.rule_engine.skill_taxonomy import SKILL_ALIASES, SKILL_EQUIVALENTS, DEPTH_SIGNALS

PRESENCE_WEIGHT = 0.60
DEPTH_WEIGHT    = 0.40
IMPORTANCE_WEIGHTS = {"must": 3.0, "good": 1.5, "bonus": 0.5}
_WINDOW = 60


def _aliases_for(skill: str) -> List[str]:
    key = (skill or "").strip().lower()
    return SKILL_ALIASES.get(key, [key])


def _contains(haystack: str, needle: str) -> bool:
    n = needle.lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9 .]*[a-z0-9]|[a-z0-9]", n):
        if re.search(r"\b" + re.escape(n) + r"\b", haystack):
            return True
    idx = 0
    while True:
        pos = haystack.find(n, idx)
        if pos == -1:
            return False
        before = pos == 0 or not haystack[pos-1].isalnum()
        end = pos + len(n)
        after = end == len(haystack) or not haystack[end].isalnum()
        if before and after:
            return True
        idx = pos + 1


def _skill_present(haystack: str, skill: str) -> bool:
    if any(_contains(haystack, a) for a in _aliases_for(skill)):
        return True
    # First try exact match or alias
    if any(_contains(haystack, a) for a in _aliases_for(skill)):
        return True

    # Handle compound skills with & / and
    # "Figma & Prototyping" → check if "Figma" AND "Prototyping" are both present
    import re as _re
    parts = _re.split(r'\s*[&/]\s*|\s+and\s+', skill, flags=_re.IGNORECASE)
    if len(parts) > 1:
        cleaned = [p.strip() for p in parts if p.strip()]
        if all(_contains(haystack, p.lower()) for p in cleaned):
            return True

    return False


def _equivalent_credit(haystack: str, skill: str) -> float:
    key = (skill or "").strip().lower()
    best = 0.0
    for equiv_name, credit in SKILL_EQUIVALENTS.get(key, []):
        for alias in _aliases_for(equiv_name):
            if _contains(haystack, alias):
                best = max(best, credit)
                break
    return best


def _depth_score_for_skill(haystack: str, skill: str) -> int:
    aliases = list(_aliases_for(skill))
    # For multi-word skills like "Oracle VBCS", also try short form
    skip_words = {'oracle', 'apache', 'amazon', 'google', 'microsoft', 'visual', 'cloud', 'builder'}
    for part in skill.strip().split():
        if len(part) > 3 and part.lower() not in skip_words:
            if part.lower() not in [a.lower() for a in aliases]:
                aliases.append(part.lower())
    depth = 0
    seen: List[int] = []
    for alias in aliases:
        idx = 0
        while True:
            pos = haystack.find(alias.lower(), idx)
            if pos == -1:
                break
            if any(abs(pos - p) < 20 for p in seen):  # only skip duplicate within same word
                idx = pos + 1
                continue
            seen.append(pos)
            window = haystack[max(0, pos-_WINDOW): pos+_WINDOW+len(alias)]
            tight_window = haystack[max(0, pos-30): pos+30+len(alias)]
            for signal, pts in DEPTH_SIGNALS.items():
                sig = signal.lower()
                # "years" must be very close to the skill mention
                if sig == 'years':
                    if sig in tight_window:
                        depth += pts
                elif sig in window:
                    depth += pts
            idx = pos + 1
    return max(-15, min(25, depth))


def score_technical(
    resume_text: str,
    required_skills: List[Dict],
    skill_importance: Dict[str, str],
    custom_aliases: Dict[str, List[str]] = None,
    custom_equivalents: Dict[str, List[str]] = None,
) -> Dict:
    haystack = (resume_text or "").lower()
    must_have, good_to_have, bonus = [], [], []

    for skill in (required_skills or []):
        name = skill.get("skill", skill) if isinstance(skill, dict) else skill
        imp  = skill_importance.get(name, "must")
        if imp == "must":       must_have.append(name)
        elif imp == "good":     good_to_have.append(name)
        else:                   bonus.append(name)

    all_skills = (
        [(n, "must")  for n in must_have] +
        [(n, "good")  for n in good_to_have] +
        [(n, "bonus") for n in bonus]
    )

    found, partial, missing = [], [], []
    found_via_alias: List[str] = []
    partial_via_equiv: List[str] = []
    skills_to_verify: List[dict] = []
    max_presence = earned_presence = 0.0
    total_depth = depth_count = 0.0

    for name, importance in all_skills:
        weight = IMPORTANCE_WEIGHTS[importance]
        max_presence += weight

        # Check exact match or taxonomy alias
        skill_found = _skill_present(haystack, name)

        # Check custom aliases (100% credit)
        alias_match = None
        if not skill_found and custom_aliases and name in custom_aliases:
            for alias in custom_aliases[name]:
                if _contains(haystack, alias.lower()):
                    skill_found = True
                    alias_match = alias
                    break

        if skill_found:
            found.append(name)
            if alias_match:
                found_via_alias.append(f"{alias_match} (alias for {name})")
            earned_presence += weight
            depth = _depth_score_for_skill(haystack, name)
            total_depth += depth
            depth_count += 1
            # Flag low confidence skills (found but no depth evidence)
            if depth < 5:
                skills_to_verify.append({
                    "skill": name,
                    "reason": "Detected in resume but no project work or action verbs found nearby. Recommend manual verification."
                })
        else:
            # Check custom equivalents (90% credit)
            custom_equiv_credit = 0.0
            custom_equiv_match = None
            if custom_equivalents and name in custom_equivalents:
                for equiv in custom_equivalents[name]:
                    if _contains(haystack, equiv.lower()):
                        custom_equiv_credit = 0.90
                        custom_equiv_match = equiv
                        break

            if custom_equiv_credit > 0:
                partial.append(name)
                partial_via_equiv.append(f"{custom_equiv_match} (similar to {name})")
                earned_presence += weight * custom_equiv_credit
                total_depth += _depth_score_for_skill(haystack, name) * 0.5
                depth_count += 0.5
            else:
                # Fall back to taxonomy equivalents (45% credit)
                credit = _equivalent_credit(haystack, name)
                if credit > 0:
                    partial.append(name)
                    earned_presence += weight * credit
                    total_depth += _depth_score_for_skill(haystack, name) * 0.5
                    depth_count += 0.5
                else:
                    missing.append(name)

    presence_score = (earned_presence / max_presence * 100) if max_presence > 0 else 0

    if depth_count > 0:
        avg_depth = total_depth / depth_count
        depth_score = max(0, min(100, 50 + avg_depth * 2))
    else:
        depth_score = 30

    raw = presence_score * PRESENCE_WEIGHT + depth_score * DEPTH_WEIGHT
    score = max(0, min(100, int(round(raw))))
    must_have_missing = sum(1 for n in must_have if n in missing)
    total_must_have   = len(must_have)

    return {
        "score":             score,
        "found":             found,
        "partial":           partial,
        "missing":           missing,
        "must_have_missing": must_have_missing,
        "total_must_have":   total_must_have,
        "presence_score":    int(round(presence_score)),
        "depth_score":       int(round(depth_score)),
        "found_via_alias":   found_via_alias,
        "partial_via_equiv": partial_via_equiv,
        "skills_to_verify":  skills_to_verify,
    }


def apply_must_have_ceiling(score: int, must_have_missing: int, total_must_have: int = 0) -> int:
    if must_have_missing == 0:
        return score
    pct = (must_have_missing / total_must_have * 100) if total_must_have > 0 else must_have_missing * 25
    if pct <= 20:   ceiling = 85
    elif pct <= 40: ceiling = 70
    elif pct <= 60: ceiling = 50
    elif pct <= 80: ceiling = 30
    else:           ceiling = 15
    return min(score, ceiling)
