"""
Scorer - hybrid rule engine + AI pipeline.
Auto-extracts skills from JD text when no manual skills defined.
"""
from __future__ import annotations
from services.rule_engine import (
    score_technical, score_experience,
    score_education, score_stability,
)
from services.ai.prompt_builder  import SYSTEM_PROMPT, build_user_prompt
from services.ai.response_parser import parse_ai_response, build_final_scores
from services.ai.jd_extractor   import extract_skills_from_jd, build_extracted_skill_importance
from services.ai.router          import get_adapter
from services.resume_compressor  import compress_resume
from db.supabase_client          import supabase
from config                      import settings


async def _get_skills(job: dict) -> tuple:
    """
    Returns (required_skills, skill_importance).
    Priority:
      1. Manual skills defined by recruiter
      2. Cached extracted skills in DB
      3. Extract from JD text now and cache
      4. Empty - AI scores freely
    """
    manual = job.get("required_skills", [])
    if manual and len(manual) > 0:
        print(f"Using {len(manual)} manual skills")
        return manual, job.get("skill_importance", {})

    cached = job.get("extracted_skills", [])
    if cached and len(cached) > 0:
        print(f"Using {len(cached)} cached extracted skills: {cached[:3]}")
        return build_extracted_skill_importance(cached)

    jd_text = (job.get("description") or "").strip()
    if len(jd_text) > 50:
        print(f"Extracting skills from JD text...")
        extracted = await extract_skills_from_jd(jd_text)
        if extracted:
            print(f"Extracted {len(extracted)} skills: {extracted}")
            try:
                supabase.table("job_descriptions").update({
                    "extracted_skills":    extracted,
                    "skills_extracted_at": "now()",
                }).eq("id", job["id"]).execute()
            except Exception as e:
                print(f"Cache save error: {e}")
            return build_extracted_skill_importance(extracted)

    print("No skills found anywhere - AI scores freely")
    return [], {}


async def score_resume(
    resume_text: str,
    job: dict,
    candidate_name: str = "Unknown",
) -> dict:

    print(f"Job keys: {list(job.keys())}")
    print(f"Description length: {len(job.get('description') or '')}")
    print(f"Manual skills: {len(job.get('required_skills') or [])}")
    print(f"Extracted skills: {job.get('extracted_skills')}")
    required_skills, skill_importance = await _get_skills(job)
    no_skills = len(required_skills) == 0

    exp_min = int(job.get("experience_min") or 0)
    exp_max = int(job.get("experience_max") or 0)
    edu_req = job.get("education_required", "")

    custom_aliases    = job.get("skill_aliases", {}) or {}
    custom_equivalents = job.get("skill_equivalents", {}) or {}
    tech_result  = score_technical(
        resume_text, required_skills, skill_importance,
        custom_aliases=custom_aliases,
        custom_equivalents=custom_equivalents,
    )
    exp_result   = score_experience(resume_text, exp_min, exp_max)
    edu_result   = score_education(resume_text, edu_req)
    stab_result  = score_stability(resume_text)

    if no_skills:
        tech_result["score"]             = 50
        tech_result["found"]             = []
        tech_result["missing"]           = []
        tech_result["must_have_missing"] = 0

    rule_scores = {
        "technical":  tech_result,
        "experience": exp_result,
        "education":  edu_result,
        "stability":  stab_result,
    }

    compressed  = compress_resume(resume_text)
    user_prompt = build_user_prompt(
        resume_text      = compressed,
        jd               = job,
        candidate_name   = candidate_name,
        rule_scores      = rule_scores,
        technical_detail = tech_result,
        no_skills        = no_skills,
    )

    adapter = get_adapter()
    raw_response, tokens_used = await adapter.score(
        system_prompt = SYSTEM_PROMPT,
        user_prompt   = user_prompt,
        max_tokens    = settings.AI_MAX_TOKENS,
        temperature   = settings.AI_TEMPERATURE,
    )

    ai_response = parse_ai_response(raw_response)

    final = build_final_scores(
        rule_scores       = rule_scores,
        ai_response       = ai_response,
        job               = job,
        must_have_missing = tech_result["must_have_missing"],
    )

    final["tokens_used"] = tokens_used
    final["model_used"]  = settings.AI_PROVIDER
    return final
