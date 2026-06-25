"""
Download endpoints — generate and serve final documents.
Options:
  - Resume only (DOCX or PDF)
  - Scorecard only (PDF)
  - Combined: resume + scorecard as last page (PDF)

Action items are NEVER included in downloads — they're internal-only.
"""
import logging
import traceback

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import Response
from typing import Optional

from db.supabase_client import supabase
from services.pdf_generator import (
    generate_resume_pdf,
    generate_scorecard_pdf,
    generate_combined_pdf,
)
from services.docx_generator import create_corporate_resume
from config import settings


router = APIRouter(prefix="/api/v1/download", tags=["download"])
logger = logging.getLogger("scorcraft.download")


def _get_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        return user.user.id
    except Exception as e:
        # A common prod cause: the backend's SUPABASE_URL points at a different
        # project than the frontend issued the token for, so validation always
        # fails. Log the reason (server-side only) to make that diagnosable.
        logger.warning("Token validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _fetch_logo_bytes(logo_path: Optional[str]) -> Optional[bytes]:
    """Download the user's uploaded logo for the PDF footer. The logo lives in
    the formatted-resumes bucket (path: logos/{user_id}_logo.png), saved there
    by the Craft Settings UI. If no logo was uploaded (logo_path is null) or it
    can't be fetched, return None so the footer renders company text only — a
    missing logo must never break a download."""
    if not logo_path:
        return None
    try:
        content = supabase.storage.from_(settings.FORMATTED_BUCKET).download(logo_path)
        return content or None
    except Exception as e:
        logger.info("Logo '%s' not found in bucket '%s' (%s) — footer renders without it",
                    logo_path, settings.FORMATTED_BUCKET, e)
        return None


def _company_kwargs(craft_settings: dict) -> dict:
    """Footer/company params shared by resume + combined PDFs."""
    return {
        "company_name": craft_settings.get("company_name", "HYROI Solutions"),
        "company_tagline": craft_settings.get("company_tagline"),
        "company_email": craft_settings.get("company_email"),
        "company_phone": craft_settings.get("company_phone"),
        "logo_path": _fetch_logo_bytes(craft_settings.get("logo_storage_path")),
    }


def _fetch_craft_and_score(craft_id: str) -> tuple:
    """Fetch crafted resume and its associated score data."""
    craft_res = supabase.table("crafted_resumes").select("*").eq("id", craft_id).execute()
    if not craft_res.data:
        raise HTTPException(status_code=404, detail="Crafted resume not found")
    craft = craft_res.data[0]

    score_res = supabase.table("scores").select(
        "*, candidates(*)"
    ).eq("id", craft["score_id"]).execute()
    score = score_res.data[0] if score_res.data else {}

    job_res = supabase.table("job_descriptions").select("*").eq(
        "id", craft.get("job_id") or score.get("job_id", "")
    ).execute()
    job = job_res.data[0] if job_res.data else {}

    return craft, score, job


# ── DOCX download (resume only) ─────────────────────────────

@router.get("/{craft_id}/docx")
async def download_docx(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """Download crafted resume as DOCX.

    Tries the pre-generated file in Supabase storage first; if that file is
    missing (e.g. the best-effort upload during crafting failed in prod), the
    DOCX is regenerated on-the-fly from the structured_data stored in the DB so
    the download never depends on a successful prior upload.
    """
    try:
        _get_user(authorization)

        # 1. The crafted_resumes record must exist.
        craft_res = supabase.table("crafted_resumes").select("*").eq("id", craft_id).execute()
        if not craft_res.data:
            raise HTTPException(
                status_code=404,
                detail=f"Crafted resume '{craft_id}' not found. Craft it before downloading.",
            )

        craft = craft_res.data[0]
        structured_data = craft.get("structured_data") or {}
        craft_settings = craft.get("craft_settings") or {}
        file_path = craft.get("formatted_file_path")

        # 2. Prefer the pre-generated file from storage.
        content = None
        if file_path:
            try:
                content = supabase.storage.from_(settings.FORMATTED_BUCKET).download(file_path)
            except Exception as e:
                logger.warning(
                    "Stored DOCX '%s' unavailable in bucket '%s' (%s) — regenerating on-the-fly",
                    file_path, settings.FORMATTED_BUCKET, e,
                )

        # 3. Fallback: regenerate the DOCX from structured_data.
        if not content:
            if not structured_data:
                raise HTTPException(
                    status_code=404,
                    detail="No formatted file in storage and no structured_data to regenerate from.",
                )
            content = create_corporate_resume(
                structured_data,
                company_name=craft_settings.get("company_name", "HYROI Solutions"),
                mask_contacts=craft_settings.get("mask_pi", False),
            )

        # 4. Build a safe filename (structured_data may be null/missing).
        candidate_info = structured_data.get("candidate_info") or {}
        candidate_name = candidate_info.get("full_name") or "resume"
        safe_name = candidate_name.encode("ascii", "ignore").decode("ascii").strip() or "resume"

        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}_crafted.docx"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("DOCX download failed for craft_id=%s", craft_id)
        raise HTTPException(status_code=500, detail=f"DOCX download failed: {e}")


# ── PDF downloads ────────────────────────────────────────────

@router.get("/{craft_id}/resume-pdf")
async def download_resume_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """Download crafted resume as PDF (without scorecard)."""
    try:
        _get_user(authorization)
        craft, score, job = _fetch_craft_and_score(craft_id)

        structured_data = craft.get("structured_data") or {}
        craft_settings = craft.get("craft_settings") or {}

        pdf_bytes = generate_resume_pdf(
            data=structured_data,
            mask_contacts=craft_settings.get("mask_pi", False),
            **_company_kwargs(craft_settings),
        )

        candidate_info = structured_data.get("candidate_info") or {}
        candidate_name = candidate_info.get("full_name") or "resume"
        safe_name = candidate_name.encode("ascii", "ignore").decode("ascii").strip() or "resume"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_resume.pdf"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Resume PDF download failed for craft_id=%s", craft_id)
        raise HTTPException(status_code=500, detail=f"Resume PDF download failed: {e}")


@router.get("/{craft_id}/scorecard-pdf")
async def download_scorecard_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """Download ScorQ scorecard as PDF (matches existing ScorQ format)."""
    try:
        _get_user(authorization)
        craft, score, job = _fetch_craft_and_score(craft_id)

        candidate = score.get("candidates") or {}
        craft_settings = craft.get("craft_settings") or {}
        structured_data = craft.get("structured_data") or {}
        logo_path = _fetch_logo_bytes(craft_settings.get("logo_storage_path"))

        # Apply PI masking to scorecard if enabled
        mask = craft_settings.get("mask_pi", False)

        pdf_bytes = generate_scorecard_pdf(
            candidate_name=candidate.get("name", "Unknown"),
            candidate_email=None if mask else candidate.get("email"),
            candidate_phone=None if mask else candidate.get("phone"),
            overall_score=score.get("overall_score", 0),
            category_scores=score.get("category_scores", {}),
            matched_skills=score.get("matched_skills", []),
            missing_skills=score.get("missing_skills", []),
            highlights=score.get("highlights", []),
            red_flags=score.get("red_flags", []),
            ai_reasoning=score.get("ai_reasoning", ""),
            job_title=job.get("title", ""),
            logo_path=logo_path,
            certifications=structured_data.get("certifications"),
        )

        safe_name = (candidate.get("name") or "scorecard").encode("ascii", "ignore").decode("ascii").strip() or "scorecard"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_scorecard.pdf"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Scorecard PDF download failed for craft_id=%s", craft_id)
        raise HTTPException(status_code=500, detail=f"Scorecard PDF download failed: {e}")


@router.get("/{craft_id}/combined-pdf")
async def download_combined_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Combined PDF: crafted resume pages + full scorecard as last page.
    Action items are NOT included — they're internal-only.
    """
    try:
        _get_user(authorization)
        craft, score, job = _fetch_craft_and_score(craft_id)

        structured_data = craft.get("structured_data") or {}
        candidate = score.get("candidates") or {}
        craft_settings = craft.get("craft_settings") or {}
        mask = craft_settings.get("mask_pi", False)

        pdf_bytes = generate_combined_pdf(
            # Resume data
            resume_data=structured_data,
            mask_contacts=mask,
            # Scorecard data
            candidate_name=candidate.get("name", "Unknown"),
            candidate_email=None if mask else candidate.get("email"),
            candidate_phone=None if mask else candidate.get("phone"),
            overall_score=score.get("overall_score", 0),
            category_scores=score.get("category_scores", {}),
            matched_skills=score.get("matched_skills", []),
            missing_skills=score.get("missing_skills", []),
            highlights=score.get("highlights", []),
            red_flags=score.get("red_flags", []),
            ai_reasoning=score.get("ai_reasoning", ""),
            job_title=job.get("title", ""),
            **_company_kwargs(craft_settings),
        )

        safe_name = (candidate.get("name") or "candidate").encode("ascii", "ignore").decode("ascii").strip() or "candidate"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}_scorcraft.pdf"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Combined PDF download failed for craft_id=%s", craft_id)
        raise HTTPException(status_code=500, detail=f"Combined PDF download failed: {e}")
