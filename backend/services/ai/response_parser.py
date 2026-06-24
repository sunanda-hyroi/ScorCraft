"""
Response Parser — 4 categories only. Soft Skills removed.
"""
from __future__ import annotations
import json
import re
from typing import Dict, List, Optional

CATEGORIES = ["technical", "experience", "education", "stability"]
DEFAULT_WEIGHTS = {
    "technical": 50, "experience": 25,
    "education": 15, "stability": 10,
}


def parse_ai_response(raw_text: str) -> Dict:
    try:
        cleaned = raw_text.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        data = json.loads(cleaned)
        return {
            "experience_adjustment": _clamp_adj(data.get("experience_adjustment", 0)),
            "category_reasoning":    data.get("category_reasoning", {}),
            "highlights":            list(data.get("highlights") or []),
            "red_flags":             list(data.get("red_flags") or []),
            "ai_reasoning":          data.get("ai_reasoning", "") or "",
        }
    except Exception as e:
        return {
            "experience_adjustment": 0,
            "category_reasoning":    {},
            "highlights":            [],
            "red_flags":             [f"AI response parse error: {str(e)}"],
            "ai_reasoning":          "Could not parse AI assessment.",
        }


def build_final_scores(
    rule_scores: Dict,
    ai_response: Dict,
    job: Dict,
    must_have_missing: int,
) -> Dict:

    ai_reasoning = ai_response.get("category_reasoning", {})
    rule_tech  = rule_scores.get("technical",  {})
    rule_exp   = rule_scores.get("experience", {})
    rule_edu   = rule_scores.get("education",  {})
    rule_stab  = rule_scores.get("stability",  {})

    # Technical — rule only (ceiling applied after)
    tech_raw = rule_tech.get("score")
    tech_score = _clamp(tech_raw) if tech_raw is not None else 50

    # Experience — rule base + AI quality adjustment
    exp_raw = rule_exp.get("score")
    if exp_raw is not None:
        exp_adj   = _clamp_adj(ai_response.get("experience_adjustment", 0))
        exp_score = _clamp(exp_raw + exp_adj)
    else:
        exp_score = None

    # Education — rule only
    edu_raw   = rule_edu.get("score")
    edu_score = _clamp(edu_raw) if edu_raw is not None else None

    # Stability — rule only
    stab_score = _clamp(rule_stab.get("score", 60))

    # Apply Must Have ceiling to technical
    from services.rule_engine.technical_scorer import apply_must_have_ceiling
    total_must_have = rule_tech.get("total_must_have", 0)
    tech_score = apply_must_have_ceiling(tech_score, must_have_missing, total_must_have)

    # Build category scores
    category_scores = {
        "technical": {
            "score":     tech_score,
            "reasoning": _build_tech_reasoning(rule_tech, ai_reasoning),
        },
        "experience": {
            "score":     exp_score,
            "reasoning": ai_reasoning.get("experience") or rule_exp.get("reasoning", ""),
        },
        "education": {
            "score":     edu_score,
            "reasoning": ai_reasoning.get("education") or rule_edu.get("reasoning", ""),
            "certifications": rule_edu.get("certifications", []),
        },
        "stability": {
            "score":     stab_score,
            "reasoning": ai_reasoning.get("stability") or rule_stab.get("reasoning", ""),
        },
    }

    # Overall = technical score (primary signal)
    overall = tech_score

    # Recommendation based on technical score only
    shortlist_t = int(job.get("shortlist_threshold") or 75)
    review_t    = int(job.get("review_threshold") or 55)
    min_tech    = job.get("minimum_technical_score")
    if min_tech:
        try: min_tech = int(min_tech)
        except: min_tech = None

    recommendation = _recommend(tech_score, shortlist_t, review_t, min_tech)

    return {
        "overall_score":    overall,
        "recommendation":   recommendation,
        "category_scores":  category_scores,
        "matched_skills":   rule_tech.get("found", []),
        "missing_skills":   rule_tech.get("missing", []),
        "partial_skills":   rule_tech.get("partial", []),
        "skills_to_verify": rule_tech.get("skills_to_verify", []),
        "highlights":       ai_response.get("highlights", []),
        "red_flags":        ai_response.get("red_flags", []),
        "ai_reasoning":     ai_response.get("ai_reasoning", ""),
    }


def _build_tech_reasoning(rule_tech: Dict, ai_reasoning: Dict) -> str:
    found            = rule_tech.get("found", [])
    partial          = rule_tech.get("partial", [])
    missing          = rule_tech.get("missing", [])
    found_via_alias  = rule_tech.get("found_via_alias", [])
    partial_via_equiv= rule_tech.get("partial_via_equiv", [])

    # Use AI reasoning as the primary text if available
    # AI already knows what was found/missing from the prompt
    ai_tech = ai_reasoning.get("technical", "")
    if ai_tech:
        clean = ai_tech
        for bad in ["ceiling rule", "capped at", "Python override",
                    "deterministic", "ceiling applied"]:
            clean = clean.replace(bad, "")
        clean = clean.strip()
        if clean:
            # Append alias/equivalent info if AI did not mention it
            suffix = []
            if found_via_alias:
                suffix.append(
                    f"Matched via alias: {', '.join(found_via_alias)}."
                )
            if partial_via_equiv:
                suffix.append(
                    f"Similar skills credited: {', '.join(partial_via_equiv)}."
                )
            if suffix:
                return clean + " " + " ".join(suffix)
            return clean

    # Fallback to rule-based text only if AI gave nothing
    parts = []
    if found:
        parts.append(f"{', '.join(found)} found in resume.")
    if found_via_alias:
        parts.append(f"Matched via alias: {', '.join(found_via_alias)}.")
    if partial_via_equiv:
        parts.append(f"Similar skills credited: {', '.join(partial_via_equiv)}.")
    if partial and not partial_via_equiv:
        parts.append(f"Related skills found: {', '.join(partial)}.")
    if missing:
        parts.append(
            f"{', '.join(missing)} not found in this resume."
        )
    return " ".join(parts) if parts else "Technical skills evaluated."


def _recommend(tech: int, shortlist: int, review: int, min_tech: Optional[int]) -> str:
    if min_tech is not None and tech < min_tech:
        return "PASS"
    if tech >= shortlist: return "SHORTLIST"
    if tech >= review:    return "REVIEW"
    return "PASS"


def _clamp(val) -> int:
    try:    return max(0, min(100, int(round(float(val)))))
    except: return 50

def _clamp_adj(val) -> int:
    try:    return max(-15, min(15, int(round(float(val)))))
    except: return 0


# Backward compat
def parse_score_response(raw_text: str) -> Dict:
    return parse_ai_response(raw_text)

def apply_scoring_rules(parsed: Dict, job: Dict, resume_text: str) -> Dict:
    return parsed

def check_must_have_presence(resume_text: str, must_have_skills: List) -> Dict:
    from services.rule_engine.technical_scorer import _skill_present, _aliases_for
    haystack = resume_text.lower()
    found, missing = [], []
    for skill in (must_have_skills or []):
        name = skill.get("skill", skill) if isinstance(skill, dict) else skill
        if _skill_present(haystack, name):
            found.append(name)
        else:
            missing.append(name)
    return {"found": found, "missing": missing}
