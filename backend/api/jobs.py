"""
Job Description endpoints — create, list, get, update, delete
"""
from fastapi import APIRouter, HTTPException, Header, Body
from pydantic import BaseModel
from typing import Optional
import logging
import httpx
from db.supabase_client import supabase
from config import settings

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


def _get_auth_user(authorization: Optional[str]):
    """Resolve the Supabase auth user from the bearer token (raises 401)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        return supabase.auth.get_user(token).user
    except Exception as e:
        # If this fires for every request in prod, suspect a Supabase project
        # mismatch: the backend's SUPABASE_URL must be the SAME project the
        # frontend's NEXT_PUBLIC_SUPABASE_URL issues tokens for.
        logging.getLogger("scorcraft.jobs").warning("Token validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _get_user(authorization: Optional[str]) -> str:
    """Extract user id from bearer token."""
    return _get_auth_user(authorization).id


def _display_name(user) -> str:
    """Human-readable creator name: a name from user_metadata, else the email
    local-part (e.g. test@hyroi.com → 'test')."""
    meta = getattr(user, "user_metadata", None) or {}
    for k in ("name", "full_name", "display_name"):
        v = meta.get(k)
        if v and str(v).strip():
            return str(v).strip()
    email = getattr(user, "email", "") or ""
    return email.split("@")[0] if email else "Unknown"


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

    # Manual aliases (Feature 2): recruiter-typed aliases the AI missed (e.g.
    # OS = "Operating System" = "OperatingSystem"). They must reach the technical
    # scorer, so fold them into skill_aliases (union, de-duped case-insensitively)
    # while ALSO keeping the raw skill_manual_aliases map — persisted only if that
    # column exists — so the editor can still render them as "manual" on re-open.
    manual_aliases = payload.get("skill_manual_aliases") or {}
    skill_aliases = dict(payload.get("skill_aliases") or {})
    if isinstance(manual_aliases, dict):
        for skill, extra in manual_aliases.items():
            if not isinstance(extra, list):
                continue
            base = list(skill_aliases.get(skill) or [])
            seen = {str(a).lower() for a in base}
            for a in extra:
                if a and str(a).lower() not in seen:
                    base.append(a)
                    seen.add(str(a).lower())
            skill_aliases[skill] = base

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
        "skill_aliases": skill_aliases,
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
        "skill_manual_aliases": manual_aliases if isinstance(manual_aliases, dict) else {},
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


def _next_lineage_version(original: dict) -> tuple:
    """Compute (root_id, next_version) for the version lineage that `original`
    belongs to. Root = the original's parent, or the original itself. The next
    version is one past the max version seen across the root and all its
    children. Shared by update (edit-as-new-version) and duplicate."""
    root = original.get("parent_job_id") or original["id"]
    # Two simple queries — this supabase-py build has no .or_() helper.
    siblings = supabase.table("job_descriptions")\
        .select("version").eq("parent_job_id", root).execute().data or []
    root_row = supabase.table("job_descriptions")\
        .select("version").eq("id", root).execute().data or []
    next_version = max(
        [(r.get("version") or 1) for r in (siblings + root_row)]
        + [original.get("version") or 1]
    ) + 1
    return root, next_version


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


def _crafted_counts() -> dict:
    """Live count of crafted resumes per job_id (for the dashboard status line)."""
    counts: dict = {}
    try:
        cr = supabase.table("crafted_resumes").select("job_id").execute()
        for r in (cr.data or []):
            jid = r.get("job_id")
            if jid:
                counts[jid] = counts.get(jid, 0) + 1
    except Exception:
        pass
    return counts


def _remove_storage(bucket: str, paths: list) -> None:
    """Best-effort delete of storage objects. Never raises — storage cleanup must
    not block the DB delete (an orphaned file is far less harmful than a job that
    won't delete). Logs failures so a misconfigured bucket stays diagnosable."""
    paths = [p for p in (paths or []) if p]
    if not paths:
        return
    try:
        supabase.storage.from_(bucket).remove(paths)
    except Exception as e:
        logging.getLogger("scorcraft.jobs").warning(
            "Storage cleanup on bucket %r failed for %d path(s): %s", bucket, len(paths), e)


def _cascade_delete_job(job_id: str) -> dict:
    """Permanently delete a job and EVERY piece of data linked to it (Feature 4).

    Data lives as long as the job — so deleting the job is the single point where
    it all gets cleaned up. Runs in FK-safe order and cleans Supabase storage too:

      1. crafted_resumes  (+ formatted DOCX & rendered-doc cache in storage)
      2. scores
      3. scoring_sessions
      4. candidates that no longer have ANY score in another job (+ resume files)
      5. the job row itself

    Explicit deletes (not relying on ON DELETE CASCADE) so this works regardless
    of the base ScorQ FK definitions AND lets us collect storage paths to purge.
    Returns a summary of what was removed.
    """
    log = logging.getLogger("scorcraft.jobs")
    summary = {"crafted": 0, "scores": 0, "sessions": 0, "candidates": 0}

    # ── Gather candidate ids + resume file paths for this job (via its scores) ──
    scores = supabase.table("scores").select("id, candidate_id").eq("job_id", job_id).execute().data or []
    candidate_ids = {s.get("candidate_id") for s in scores if s.get("candidate_id")}

    # ── 1. crafted_resumes — purge formatted DOCX + rendered-doc cache first ──
    crafts = supabase.table("crafted_resumes").select("id, formatted_file_path")\
        .eq("job_id", job_id).execute().data or []
    formatted_paths: list = []
    for cr in crafts:
        cid = cr.get("id")
        if cr.get("formatted_file_path"):
            formatted_paths.append(cr["formatted_file_path"])
        if cid:
            # Rendered-document cache written by api/download.py.
            formatted_paths += [
                f"cache/{cid}.docx.docx",
                f"cache/{cid}.resume-pdf.pdf",
                f"cache/{cid}.scorecard-pdf.pdf",
                f"cache/{cid}.combined-pdf.pdf",
                f"cache/{cid}.combined-docx.docx",
            ]
    _remove_storage(settings.FORMATTED_BUCKET, formatted_paths)
    if crafts:
        supabase.table("crafted_resumes").delete().eq("job_id", job_id).execute()
    summary["crafted"] = len(crafts)

    # ── 2. scores ──
    if scores:
        supabase.table("scores").delete().eq("job_id", job_id).execute()
    summary["scores"] = len(scores)

    # ── 3. scoring_sessions ──
    try:
        sess = supabase.table("scoring_sessions").select("id").eq("job_id", job_id).execute().data or []
        if sess:
            supabase.table("scoring_sessions").delete().eq("job_id", job_id).execute()
        summary["sessions"] = len(sess)
    except Exception as e:
        log.warning("scoring_sessions cleanup for job %s failed: %s", job_id, e)

    # ── 4. candidates — delete only those with no remaining score in ANY job ──
    resume_paths: list = []
    for cand_id in candidate_ids:
        try:
            remaining = supabase.table("scores").select("id").eq("candidate_id", cand_id)\
                .limit(1).execute().data or []
            if remaining:
                continue  # still scored against another job → keep the candidate
            crow = supabase.table("candidates").select("resume_storage_path")\
                .eq("id", cand_id).execute().data or []
            for c in crow:
                if c.get("resume_storage_path"):
                    resume_paths.append(c["resume_storage_path"])
            supabase.table("candidates").delete().eq("id", cand_id).execute()
            summary["candidates"] += 1
        except Exception as e:
            log.warning("Candidate cleanup for %s failed: %s", cand_id, e)
    _remove_storage(settings.RESUME_STORAGE_BUCKET, resume_paths)

    # ── 5. the job row itself ──
    supabase.table("job_descriptions").delete().eq("id", job_id).execute()

    log.info("Cascade-deleted job %s: %s", job_id, summary)
    return summary


@router.get("")
async def list_jobs(
    created_by: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """All jobs (any status) for the job dashboard, newest first, each annotated
    with a live candidates_scored_count. The frontend handles status filtering,
    search and sort. Version lineage (previous_versions) is added when the
    version/parent_job_id columns exist (see Feature 3 migration).

    Optional ?created_by=<name> filters to jobs created by that person
    (case-insensitive match on created_by_name)."""
    _get_user(authorization)
    try:
        res = supabase.table("job_descriptions")\
            .select("*")\
            .order("created_at", desc=True)\
            .execute()
        jobs = res.data or []
        if created_by:
            needle = created_by.strip().lower()
            jobs = [j for j in jobs if (j.get("created_by_name") or "").lower() == needle]
        counts = _candidate_counts()
        crafted = _crafted_counts()

        # Group by version lineage: root = parent_job_id or the job's own id.
        lineage: dict = {}
        for j in jobs:
            # Prefer the authoritative live count; fall back to stored column.
            j["candidates_scored_count"] = counts.get(j["id"], j.get("candidates_scored_count") or 0)
            # Crafted-resume count powers the dashboard "N scored, M crafted" line.
            j["crafted_count"] = crafted.get(j["id"], 0)
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
    user = _get_auth_user(authorization)
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="Job title is required")
    try:
        row = _build_job_row(payload, user.id)
        # Attribution — store a readable creator name (no-op pre-migration).
        if "created_by_name" in _job_columns():
            row["created_by_name"] = _display_name(user)
        res = supabase.table("job_descriptions").insert(row).execute()
        return {"job": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{job_id}/duplicate")
async def duplicate_job(
    job_id: str,
    payload: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    """Duplicate a job as the next version in its lineage (ScorQ's edit-as-new
    -version flow — Duplicate IS the edit). The (optionally edited) payload seeds
    a brand-new row with version = original.version + 1 and parent_job_id = the
    lineage root, then the ORIGINAL is archived so only the latest version is
    active. Falls back to a plain copy (version 1) if the versioning columns
    aren't present yet.
    """
    user = _get_auth_user(authorization)
    try:
        cur = supabase.table("job_descriptions").select("*").eq("id", job_id).execute()
        if not cur.data:
            raise HTTPException(status_code=404, detail="Job not found")
        original = cur.data[0]

        cols = _job_columns()
        versioning_available = "version" in cols and "parent_job_id" in cols

        # Seed from the original, override with any edited fields the user saved.
        merged = {**original, **(payload or {})}
        if not (merged.get("title") or "").strip():
            raise HTTPException(status_code=422, detail="Job title is required")

        row = _build_job_row(merged, user.id)
        row["status"] = "active"
        if "candidates_scored_count" in cols:
            row["candidates_scored_count"] = 0  # fresh version, not yet scored
        # Attribution — keep the original creator's name across versions.
        if "created_by_name" in cols:
            row["created_by_name"] = original.get("created_by_name") or _display_name(user)

        if versioning_available:
            root, next_version = _next_lineage_version(original)
            row["version"] = next_version
            row["parent_job_id"] = root
        row = {k: v for k, v in row.items() if k in cols}

        created = supabase.table("job_descriptions").insert(row).execute()

        # Archive the original so only the latest version stays active.
        archived = False
        if versioning_available:
            try:
                supabase.table("job_descriptions")\
                    .update({"status": "archived"}).eq("id", job_id).execute()
                archived = True
            except Exception as e:
                logging.getLogger("scorcraft.jobs").warning(
                    "Duplicate: could not archive original %s: %s", job_id, e)

        return {
            "job": created.data[0],
            "versioned": versioning_available,
            "parent_job_id": job_id,
            "archived_original": archived,
        }
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
            root, next_version = _next_lineage_version(original)

            new_row = dict(row)
            new_row["version"] = next_version
            new_row["parent_job_id"] = root
            new_row["status"] = "active"
            if "candidates_scored_count" in cols:
                new_row["candidates_scored_count"] = 0  # fresh version, not yet scored
            if original.get("user_id"):
                new_row["user_id"] = original["user_id"]
            # Keep the original creator's attribution across versions.
            if "created_by_name" in cols and original.get("created_by_name"):
                new_row["created_by_name"] = original["created_by_name"]
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

    Feature 4/5: a hard delete now ALWAYS proceeds and cascades — it removes every
    score, crafted resume, scoring session, orphaned candidate, and the uploaded
    resume / formatted-doc files in Supabase storage that are linked to this job.
    There is no longer a block that forces the recruiter to archive; the frontend
    warns them about the data loss and lets them decide. Archiving (soft, the
    default) only flips the status and preserves everything, fully browsable.
    """
    _get_user(authorization)
    try:
        # Confirm the job exists so a bad id 404s instead of silently succeeding.
        cur = supabase.table("job_descriptions").select("id").eq("id", job_id).execute()
        if not cur.data:
            raise HTTPException(status_code=404, detail="Job not found")

        if hard:
            summary = _cascade_delete_job(job_id)
            return {"message": "Job deleted", "deleted": summary}

        supabase.table("job_descriptions")\
            .update({"status": "archived"})\
            .eq("id", job_id)\
            .execute()
        return {"message": "Job archived"}
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("scorcraft.jobs").error("Delete job %s failed: %s", job_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to delete job: {e}")


@router.post("/{job_id}/unarchive")
async def unarchive_job(
    job_id: str,
    authorization: Optional[str] = Header(None),
):
    """Reactivate an archived job (Feature 5) so recruiters can resume work on it.
    All its scores and crafted resumes are already intact — this just flips the
    status back to active."""
    _get_user(authorization)
    try:
        cur = supabase.table("job_descriptions").select("id").eq("id", job_id).execute()
        if not cur.data:
            raise HTTPException(status_code=404, detail="Job not found")
        res = supabase.table("job_descriptions")\
            .update({"status": "active"})\
            .eq("id", job_id)\
            .execute()
        return {"message": "Job unarchived", "job": (res.data or [{}])[0]}
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
