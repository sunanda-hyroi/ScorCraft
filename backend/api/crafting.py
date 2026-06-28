"""
Crafting endpoints — format scored resumes into polished documents.
Only candidates who passed scoring can be crafted.
"""
import logging
import uuid
from fastapi import APIRouter, HTTPException, Header, Body, UploadFile, File
from typing import Optional, List
from pydantic import BaseModel

from db.supabase_client import supabase
from services.ai_processor import extract_and_structure_resume, generate_missing_report
from services.docx_generator import create_corporate_resume
from config import settings


router = APIRouter(prefix="/api/v1/craft", tags=["crafting"])
logger = logging.getLogger("scorcraft.craft")


# ── Request / Response models ────────────────────────────────

class CraftSettings(BaseModel):
    mask_pi: bool = False
    company_name: Optional[str] = "HYROI Solutions"
    company_tagline: Optional[str] = "Talent Acquisition & Recruitment"
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    logo_storage_path: Optional[str] = None
    # Optional resume header/footer (default ON). Control only the resume pages;
    # the scorecard always keeps its own ScorQ header/footer.
    include_header: bool = True
    include_footer: bool = True


class CraftSingleRequest(BaseModel):
    score_id: str
    settings: CraftSettings = CraftSettings()


class CraftBatchRequest(BaseModel):
    score_ids: List[str]
    settings: CraftSettings = CraftSettings()


# ── Auth helper ──────────────────────────────────────────────

def _get_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Core craft logic ─────────────────────────────────────────

def _resolve_logo_path(craft_settings: CraftSettings, user_id: Optional[str]) -> None:
    """Belt-and-suspenders: the company logo is uploaded by the Craft Settings UI
    to a deterministic path (logos/{user_id}_logo.png) in the formatted-resumes
    bucket. The frontend is supposed to pass that path in craft_settings, but its
    logoPath state is ephemeral and resets on reload — so crafts could land with
    logo_storage_path=null and silently lose the logo in downloads. If the path
    is missing but a logo file exists in storage for this user, backfill it here
    so the logo survives regardless of frontend state. Mutates craft_settings."""
    if craft_settings.logo_storage_path or not user_id:
        return
    name = f"{user_id}_logo.png"
    try:
        files = supabase.storage.from_(settings.FORMATTED_BUCKET).list("logos")
        if any(f.get("name") == name for f in (files or [])):
            craft_settings.logo_storage_path = f"logos/{name}"
            logger.info("Backfilled logo_storage_path for user %s from storage", user_id)
    except Exception as e:
        logger.info("Logo path backfill skipped for user %s (%s)", user_id, e)


def _fetch_logo_bytes(logo_path: Optional[str]) -> Optional[bytes]:
    """Download the company logo from storage so the DOCX banner can embed it.
    Returns None if no logo or it can't be fetched (banner falls back to text)."""
    if not logo_path:
        return None
    try:
        return supabase.storage.from_(settings.FORMATTED_BUCKET).download(logo_path) or None
    except Exception as e:
        logger.info("Logo bytes fetch skipped for '%s' (%s)", logo_path, e)
        return None


async def _craft_single(score_id: str, craft_settings: CraftSettings, user_id: Optional[str] = None) -> dict:
    """
    Craft a single scored resume:
    1. Fetch score + raw resume text from DB
    2. Run AI extraction/rewriting via OpenAI
    3. Generate DOCX
    4. Save to storage + DB
    5. Return structured data for frontend editor
    """
    # 1. Fetch the score record (must exist — scoring happened first)
    score_res = supabase.table("scores").select(
        "*, candidates(*)"
    ).eq("id", score_id).execute()

    if not score_res.data:
        raise HTTPException(status_code=404, detail="Score not found. Resume must be scored first.")

    score = score_res.data[0]
    candidate = score.get("candidates", {})
    resume_text = score.get("resume_raw_text", "")

    if not resume_text:
        # Try to fetch from storage
        storage_path = candidate.get("resume_storage_path")
        if storage_path:
            try:
                from services.text_extractor import extract_text
                file_content = supabase.storage.from_(
                    settings.RESUME_STORAGE_BUCKET
                ).download(storage_path)
                filename = candidate.get("resume_filename", "resume.pdf")
                success, text = extract_text(file_content, filename)
                if success:
                    resume_text = text
            except Exception:
                pass

    if not resume_text:
        raise HTTPException(
            status_code=400,
            detail="No resume text available for crafting."
        )

    # 2. Fetch job description for context
    job_id = score.get("job_id")
    job_description = None
    if job_id:
        job_res = supabase.table("job_descriptions").select(
            "description, title"
        ).eq("id", job_id).execute()
        if job_res.data:
            job_description = job_res.data[0].get("description", "")

    # 3. Run AI extraction + rewriting (OpenAI)
    ai_result = extract_and_structure_resume(
        resume_text,
        job_description=job_description,
    )

    if not ai_result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"AI processing failed: {ai_result.get('error', 'Unknown error')}"
        )

    structured_data = ai_result["data"]
    missing_report = ai_result.get("missing_report", {})

    # 3b. Backfill the logo path from storage if the frontend didn't send it.
    _resolve_logo_path(craft_settings, user_id)

    # 4. Apply PI masking if requested
    if craft_settings.mask_pi:
        info = structured_data.get("candidate_info", {})
        info["email"] = None
        info["phone"] = None
        structured_data["candidate_info"] = info

    # 5. Generate DOCX (branded banner + footer follow the craft toggles)
    docx_content = create_corporate_resume(
        structured_data,
        company_name=craft_settings.company_name,
        mask_contacts=craft_settings.mask_pi,
        logo_bytes=_fetch_logo_bytes(craft_settings.logo_storage_path),
        company_tagline=craft_settings.company_tagline,
        include_header=craft_settings.include_header,
        include_footer=craft_settings.include_footer,
    )

    # 6. Save formatted DOCX to storage
    craft_id = str(uuid.uuid4())
    formatted_filename = f"{craft_id}_crafted.docx"

    try:
        supabase.storage.from_(settings.FORMATTED_BUCKET).upload(
            formatted_filename,
            docx_content,
            {
                "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "upsert": "true",
            },
        )
    except Exception as e:
        # Best-effort: download regenerates from structured_data if this fails,
        # but log it so a misconfigured bucket / RLS policy is diagnosable
        # instead of silently swallowed.
        logger.warning(
            "Formatted DOCX upload to bucket '%s' failed for %s: %s",
            settings.FORMATTED_BUCKET, formatted_filename, e,
        )

    # 7. Save craft record to DB
    craft_record = {
        "id": craft_id,
        "score_id": score_id,
        "candidate_id": candidate.get("id"),
        "job_id": job_id,
        # Persist the crafting user so the logo-backfill safety net
        # (_resolve_logo_path) and audits can always resolve the owner. Without
        # this the column was silently NULL on every row, which masked logo
        # regressions and made crafts un-attributable.
        "user_id": user_id,
        "structured_data": structured_data,
        "missing_report": missing_report,
        "formatted_file_path": formatted_filename,
        "craft_settings": craft_settings.dict(),
        "status": "crafted",
    }

    try:
        supabase.table("crafted_resumes").insert(craft_record).execute()
    except Exception as e:
        print(f"DB save warning: {e}")

    return {
        "craft_id": craft_id,
        "score_id": score_id,
        "candidate_name": candidate.get("name", "Unknown"),
        "candidate_email": None if craft_settings.mask_pi else candidate.get("email"),
        "candidate_phone": None if craft_settings.mask_pi else candidate.get("phone"),
        "overall_score": score.get("overall_score"),
        "structured_data": structured_data,
        "missing_report": missing_report,
        "download_url": f"/api/v1/download/{craft_id}/docx",
        "status": "crafted",
    }


# ── Endpoints ────────────────────────────────────────────────

@router.post("/single")
async def craft_single(
    request: CraftSingleRequest,
    authorization: Optional[str] = Header(None),
):
    """Craft a single scored resume."""
    user_id = _get_user(authorization)
    return await _craft_single(request.score_id, request.settings, user_id)


@router.post("/batch")
async def craft_batch(
    request: CraftBatchRequest,
    authorization: Optional[str] = Header(None),
):
    """Batch-craft multiple scored resumes."""
    user_id = _get_user(authorization)

    results = []
    errors = []

    for score_id in request.score_ids:
        try:
            result = await _craft_single(score_id, request.settings, user_id)
            results.append(result)
        except Exception as e:
            errors.append({"score_id": score_id, "error": str(e)})

    return {
        "total": len(request.score_ids),
        "crafted": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }


@router.put("/{craft_id}")
async def update_crafted_resume(
    craft_id: str,
    updated_data: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    Update a crafted resume with editor changes.
    The frontend sends the modified structured_data after editing.
    """
    _get_user(authorization)

    # Fetch existing craft record
    craft_res = supabase.table("crafted_resumes").select("*").eq("id", craft_id).execute()
    if not craft_res.data:
        raise HTTPException(status_code=404, detail="Crafted resume not found")

    craft = craft_res.data[0]
    craft_settings = CraftSettings(**craft.get("craft_settings", {}))

    # Regenerate DOCX with updated data (preserve banner/footer toggles + logo)
    docx_content = create_corporate_resume(
        updated_data,
        company_name=craft_settings.company_name,
        mask_contacts=craft_settings.mask_pi,
        logo_bytes=_fetch_logo_bytes(craft_settings.logo_storage_path),
        company_tagline=craft_settings.company_tagline,
        include_header=craft_settings.include_header,
        include_footer=craft_settings.include_footer,
    )

    # Re-upload formatted file
    formatted_filename = craft.get("formatted_file_path") or f"{craft_id}_crafted.docx"
    try:
        supabase.storage.from_(settings.FORMATTED_BUCKET).remove([formatted_filename])
    except Exception:
        pass
    try:
        supabase.storage.from_(settings.FORMATTED_BUCKET).upload(
            formatted_filename, docx_content,
            {
                "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "upsert": "true",
            },
        )
    except Exception as e:
        logger.warning(
            "Formatted DOCX re-upload to bucket '%s' failed for %s: %s",
            settings.FORMATTED_BUCKET, formatted_filename, e,
        )

    # Regenerate missing report
    missing_report = generate_missing_report(updated_data)

    # Update DB
    supabase.table("crafted_resumes").update({
        "structured_data": updated_data,
        "missing_report": missing_report,
        "status": "edited",
    }).eq("id", craft_id).execute()

    # Drop the rendered-document cache so the next PDF/combined download
    # regenerates from the edited data instead of serving the stale rendering.
    try:
        from api.download import invalidate_craft_cache
        invalidate_craft_cache(craft_id)
    except Exception as e:
        logger.info("Cache invalidation skipped for %s (%s)", craft_id, e)

    return {
        "craft_id": craft_id,
        "status": "updated",
        "missing_report": missing_report,
        "download_url": f"/api/v1/download/{craft_id}/docx",
    }


@router.post("/upload-logo")
async def upload_logo(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    """Upload the company logo via the backend (SERVICE KEY → bypasses Storage
    RLS, which blocks direct frontend uploads). Stored at the deterministic path
    logos/{user_id}_logo.png in the formatted-resumes bucket and returned so the
    frontend can persist it in craft_settings.logo_storage_path.
    """
    user_id = _get_user(authorization)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo too large (max 5MB).")
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Logo must be an image (PNG or JPG).")

    logo_path = f"logos/{user_id}_logo.png"
    bucket = supabase.storage.from_(settings.FORMATTED_BUCKET)
    try:
        # Overwrite any existing logo. storage3 0.5.5 honors upsert only via the
        # `x-upsert` header (the `upsert` key is ignored) — without it a repeat
        # upload to the same path 400s with "Duplicate / resource already
        # exists". As a version-proof fallback, drop any existing object first so
        # the upload is always a fresh create. The content-type is normalized to
        # image/png regardless of the source format.
        try:
            bucket.remove([logo_path])
        except Exception:
            pass
        bucket.upload(
            logo_path,
            content,
            {"content-type": "image/png", "x-upsert": "true"},
        )
    except Exception as e:
        logger.warning(
            "Backend logo upload failed (bucket=%r, path=%s): %s",
            settings.FORMATTED_BUCKET, logo_path, e,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Logo upload failed (bucket={settings.FORMATTED_BUCKET!r}): {e}",
        )

    # Best-effort signed URL so the UI can preview the stored logo immediately.
    logo_url = None
    try:
        signed = bucket.create_signed_url(logo_path, 3600)
        if isinstance(signed, dict):
            logo_url = signed.get("signedURL") or signed.get("signedUrl")
    except Exception as e:
        logger.info("Logo signed-url skipped for %s (%s)", logo_path, e)

    return {"logo_storage_path": logo_path, "logo_url": logo_url}
