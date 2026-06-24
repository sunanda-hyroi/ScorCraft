"""
Job Description endpoints — create, list, get, update, delete
"""
from fastapi import APIRouter, HTTPException, Header, Body
from pydantic import BaseModel
from typing import Optional
import httpx
from db.supabase_client import supabase
from config import settings

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


def _get_user(authorization: Optional[str]) -> str:
    """Extract user id from bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# Columns that always exist on the current job_descriptions table. Used as a
# fallback if live schema introspection fails.
_BASE_COLUMNS = {
    "user_id", "title", "description", "company", "location",
    "must_have_skills", "good_to_have_skills", "bonus_skills", "skill_aliases",
    "weight_technical", "weight_experience", "weight_education",
    "weight_soft_skills", "weight_stability",
    "shortlist_threshold", "review_threshold", "status",
}
_columns_cache: Optional[set] = None


def _job_columns() -> set:
    """Introspect the real job_descriptions columns from PostgREST (cached).

    Lets create/update persist optional ScorQ fields (experience_min/max,
    education_required, custom_instructions, skill_equivalents, required_skills,
    …) ONLY if those columns exist — so the same code works before and after
    the docs/add_job_fields.sql migration without ever 500-ing on PGRST204.
    """
    global _columns_cache
    if _columns_cache is not None:
        return _columns_cache
    try:
        r = httpx.get(
            f"{settings.SUPABASE_URL}/rest/v1/",
            headers={
                "apikey": settings.SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
            },
            timeout=10,
        )
        defs = r.json().get("definitions", {})
        props = defs.get("job_descriptions", {}).get("properties", {})
        _columns_cache = set(props.keys()) or set(_BASE_COLUMNS)
    except Exception:
        _columns_cache = set(_BASE_COLUMNS)
    return _columns_cache


def _build_job_row(payload: dict, user_id: Optional[str]) -> dict:
    """Map a ScorQ-native job payload onto real job_descriptions columns.

    The polished ScorQ form sends required_skills:[{skill,importance}] +
    scoring_weights, while the table stores must/good/bonus arrays + weight_*.
    Bridge them here, then filter to columns that actually exist.
    """
    # must/good/bonus — prefer explicit arrays, else derive from required_skills.
    must = payload.get("must_have_skills")
    good = payload.get("good_to_have_skills")
    bonus = payload.get("bonus_skills")
    req = payload.get("required_skills") or []
    if req and must is None and good is None and bonus is None:
        must, good, bonus = [], [], []
        for s in req:
            name = (s.get("skill") if isinstance(s, dict) else s) or ""
            if not name:
                continue
            imp = (s.get("importance") if isinstance(s, dict) else None) or "must"
            (good if imp == "good" else bonus if imp == "bonus" else must).append(name)
    must, good, bonus = must or [], good or [], bonus or []

    w = payload.get("scoring_weights") or {}

    def _int(*vals, default=0):
        for v in vals:
            if v is not None:
                try:
                    return int(v)
                except (TypeError, ValueError):
                    pass
        return default

    row = {
        "title": (payload.get("title") or "").strip(),
        "description": payload.get("description") or "",
        "company": payload.get("company") or "",
        "location": payload.get("location") or "",
        "must_have_skills": must,
        "good_to_have_skills": good,
        "bonus_skills": bonus,
        "skill_aliases": payload.get("skill_aliases") or {},
        "weight_technical": _int(w.get("technical"), payload.get("weight_technical"), default=40),
        "weight_experience": _int(w.get("experience"), payload.get("weight_experience"), default=25),
        "weight_education": _int(w.get("education"), payload.get("weight_education"), default=15),
        "weight_soft_skills": _int(w.get("soft_skills"), payload.get("weight_soft_skills"), default=10),
        "weight_stability": _int(w.get("stability"), payload.get("weight_stability"), default=10),
        "shortlist_threshold": _int(payload.get("shortlist_threshold"), default=75),
        "review_threshold": _int(payload.get("review_threshold"), default=55),
        # Extended fields — persisted only if the matching columns exist.
        "required_skills": req,
        "skill_importance": payload.get("skill_importance") or {},
        "skill_equivalents": payload.get("skill_equivalents") or {},
        "nice_to_have_skills": payload.get("nice_to_have_skills") or good,
        "experience_min": _int(payload.get("experience_min"), default=0),
        "experience_max": _int(payload.get("experience_max"), default=0),
        "education_required": payload.get("education_required") or "",
        "custom_instructions": payload.get("custom_instructions") or "",
    }
    if user_id:
        row["user_id"] = user_id

    cols = _job_columns()
    return {k: v for k, v in row.items() if k in cols}


def _candidate_counts() -> dict:
    """Live count of candidates scored per job_id (one score row = one candidate)."""
    counts: dict = {}
    try:
        sc = supabase.table("scores").select("job_id").execute()
        for r in (sc.data or []):
            jid = r.get("job_id")
            if jid:
                counts[jid] = counts.get(jid, 0) + 1
    except Exception:
        pass
    return counts


@router.get("")
async def list_jobs(authorization: Optional[str] = Header(None)):
    """All jobs (any status) for the job dashboard, newest first, each annotated
    with a live candidates_scored_count. The frontend handles status filtering,
    search and sort. Version lineage (previous_versions) is added when the
    version/parent_job_id columns exist (see Feature 3 migration)."""
    _get_user(authorization)
    try:
        res = supabase.table("job_descriptions")\
            .select("*")\
            .order("created_at", desc=True)\
            .execute()
        jobs = res.data or []
        counts = _candidate_counts()

        # Group by version lineage: root = parent_job_id or the job's own id.
        lineage: dict = {}
        for j in jobs:
            # Prefer the authoritative live count; fall back to stored column.
            j["candidates_scored_count"] = counts.get(j["id"], j.get("candidates_scored_count") or 0)
            root = j.get("parent_job_id") or j["id"]
            lineage.setdefault(root, []).append(j)

        # Attach previous_versions (older rows in the same lineage) to each job.
        for group in lineage.values():
            ordered = sorted(group, key=lambda x: x.get("version") or 1)
            for j in group:
                v = j.get("version") or 1
                j["previous_versions"] = [
                    {"id": o["id"], "version": o.get("version") or 1,
                     "status": o.get("status"), "created_at": o.get("created_at")}
                    for o in ordered if (o.get("version") or 1) < v
                ]
        return {"jobs": jobs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_job(
    payload: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    user_id = _get_user(authorization)
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="Job title is required")
    try:
        row = _build_job_row(payload, user_id)
        res = supabase.table("job_descriptions").insert(row).execute()
        return {"job": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    authorization: Optional[str] = Header(None)
):
    _get_user(authorization)
    try:
        res = supabase.table("job_descriptions")\
            .select("*")\
            .eq("id", job_id)\
            .execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Job not found")
        return {"job": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{job_id}")
async def update_job(
    job_id: str,
    payload: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    """Update a job — with versioning (Feature 3).

    If the job has scored candidates AND the versioning columns exist, the
    original row is preserved and ARCHIVED, and a new row is inserted as the next
    version (version+1, parent_job_id = lineage root). Otherwise the job is
    updated in place. This keeps working before the docs/add_job_versioning.sql
    migration is applied (it just can't version until the columns exist).
    """
    _get_user(authorization)
    try:
        cur = supabase.table("job_descriptions").select("*").eq("id", job_id).execute()
        if not cur.data:
            raise HTTPException(status_code=404, detail="Job not found")
        original = cur.data[0]

        cols = _job_columns()
        versioning_available = "version" in cols and "parent_job_id" in cols
        scored = _candidate_counts().get(job_id, original.get("candidates_scored_count") or 0)

        row = _build_job_row(payload, user_id=None)  # don't reassign ownership

        if scored > 0 and versioning_available:
            # Lineage root = the original's parent, or the original itself.
            root = original.get("parent_job_id") or original["id"]
            # Max version across the lineage (root + all its child versions).
            # Two simple queries — this supabase-py build has no .or_() helper.
            siblings = supabase.table("job_descriptions")\
                .select("version").eq("parent_job_id", root).execute().data or []
            root_row = supabase.table("job_descriptions")\
                .select("version").eq("id", root).execute().data or []
            next_version = max(
                [(r.get("version") or 1) for r in (siblings + root_row)]
                + [original.get("version") or 1]
            ) + 1

            new_row = dict(row)
            new_row["version"] = next_version
            new_row["parent_job_id"] = root
            new_row["status"] = "active"
            if "candidates_scored_count" in cols:
                new_row["candidates_scored_count"] = 0  # fresh version, not yet scored
            if original.get("user_id"):
                new_row["user_id"] = original["user_id"]
            new_row = {k: v for k, v in new_row.items() if k in cols}

            created = supabase.table("job_descriptions").insert(new_row).execute()
            # Archive the original so only the latest version is "active".
            supabase.table("job_descriptions")\
                .update({"status": "archived"})\
                .eq("id", job_id)\
                .execute()
            return {
                "job": created.data[0],
                "versioned": True,
                "previous_version_id": job_id,
                "version": next_version,
            }

        # No scores (or pre-migration) → safe to update in place.
        res = supabase.table("job_descriptions")\
            .update(row)\
            .eq("id", job_id)\
            .execute()
        return {"job": res.data[0], "versioned": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    hard: bool = False,
    authorization: Optional[str] = Header(None)
):
    """Archive a job (soft, default) or permanently delete it (hard=true).

    Hard delete is blocked if candidates have been scored against the job — those
    scores reference it, so the recruiter should archive instead to preserve them.
    """
    _get_user(authorization)
    try:
        if hard:
            scored = _candidate_counts().get(job_id, 0)
            if scored:
                raise HTTPException(
                    status_code=409,
                    detail=f"Job has {scored} scored candidate(s); archive it instead of deleting.",
                )
            supabase.table("job_descriptions").delete().eq("id", job_id).execute()
            return {"message": "Job deleted"}
        supabase.table("job_descriptions")\
            .update({"status": "archived"})\
            .eq("id", job_id)\
            .execute()
        return {"message": "Job archived"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ExtractSkillsRequest(BaseModel):
    description: str = ""

@router.post("/extract-skills")
async def extract_skills_endpoint(
    body: ExtractSkillsRequest,
    authorization: Optional[str] = Header(None),
):
    """Extract skills from JD text using AI."""
    _get_user(authorization)
    from services.ai.jd_extractor import extract_skills_from_jd
    if not body.description or len(body.description.strip()) < 20:
        return {"skills": []}
    skills = await extract_skills_from_jd(body.description)
    return {"skills": skills}


class SuggestAliasesRequest(BaseModel):
    skill: str = ""

@router.post("/suggest-aliases")
async def suggest_aliases_endpoint(
    body: SuggestAliasesRequest,
    authorization: Optional[str] = Header(None),
):
    """Suggest aliases and equivalents for a skill using AI."""
    _get_user(authorization)
    from services.ai.alias_suggester import suggest_aliases
    if not body.skill or len(body.skill.strip()) < 2:
        return {"aliases": [], "equivalents": []}
    result = await suggest_aliases(body.skill)
    return result
