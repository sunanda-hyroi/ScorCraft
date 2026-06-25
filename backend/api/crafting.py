"""
Crafting endpoints — format scored resumes into polished documents.
Only candidates who passed scoring can be crafted.
"""
import logging
import uuid
from fastapi import APIRouter, HTTPException, Header, Body
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

async def _craft_single(score_id: str, craft_settings: CraftSettings) -> dict:
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

    # 4. Apply PI masking if requested
    if craft_settings.mask_pi:
        info = structured_data.get("candidate_info", {})
        info["email"] = None
        info["phone"] = None
        structured_data["candidate_info"] = info

    # 5. Generate DOCX
    docx_content = create_corporate_resume(
        structured_data,
        company_name=craft_settings.company_name,
        mask_contacts=craft_settings.mask_pi,
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
    _get_user(authorization)
    return await _craft_single(request.score_id, request.settings)


@router.post("/batch")
async def craft_batch(
    request: CraftBatchRequest,
    authorization: Optional[str] = Header(None),
):
    """Batch-craft multiple scored resumes."""
    _get_user(authorization)

    results = []
    errors = []

    for score_id in request.score_ids:
        try:
            result = await _craft_single(score_id, request.settings)
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

    # Regenerate DOCX with updated data
    docx_content = create_corporate_resume(
        updated_data,
        company_name=craft_settings.company_name,
        mask_contacts=craft_settings.mask_pi,
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

    return {
        "craft_id": craft_id,
        "status": "updated",
        "missing_report": missing_report,
        "download_url": f"/api/v1/download/{craft_id}/docx",
    }


@router.post("/settings/logo")
async def upload_logo(
    authorization: Optional[str] = Header(None),
):
    """Upload company logo — handled via Supabase storage from frontend."""
    _get_user(authorization)
    return {"message": "Use Supabase storage directly from frontend to upload logo."}
