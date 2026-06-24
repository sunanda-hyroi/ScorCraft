"""
Download endpoints — generate and serve final documents.
Options:
  - Resume only (DOCX or PDF)
  - Scorecard only (PDF)
  - Combined: resume + scorecard as last page (PDF)

Action items are NEVER included in downloads — they're internal-only.
"""
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import Response
from typing import Optional

from db.supabase_client import supabase
from services.pdf_generator import (
    generate_resume_pdf,
    generate_scorecard_pdf,
    generate_combined_pdf,
)
from config import settings


router = APIRouter(prefix="/api/v1/download", tags=["download"])


def _get_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


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
    """Download crafted resume as DOCX."""
    _get_user(authorization)

    craft_res = supabase.table("crafted_resumes").select("*").eq("id", craft_id).execute()
    if not craft_res.data:
        raise HTTPException(status_code=404, detail="Crafted resume not found")

    craft = craft_res.data[0]
    file_path = craft.get("formatted_file_path")

    if not file_path:
        raise HTTPException(status_code=404, detail="No formatted file available")

    try:
        content = supabase.storage.from_(settings.FORMATTED_BUCKET).download(file_path)
        candidate_name = craft.get("structured_data", {}).get(
            "candidate_info", {}
        ).get("full_name", "resume")
        safe_name = candidate_name.encode("ascii", "ignore").decode("ascii").strip() or "resume"

        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}_crafted.docx"'
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


# ── PDF downloads ────────────────────────────────────────────

@router.get("/{craft_id}/resume-pdf")
async def download_resume_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """Download crafted resume as PDF (without scorecard)."""
    _get_user(authorization)
    craft, score, job = _fetch_craft_and_score(craft_id)

    structured_data = craft.get("structured_data", {})
    craft_settings = craft.get("craft_settings", {})
    logo_path = craft_settings.get("logo_storage_path")

    pdf_bytes = generate_resume_pdf(
        data=structured_data,
        company_name=craft_settings.get("company_name", "HYROI Solutions"),
        mask_contacts=craft_settings.get("mask_pi", False),
        logo_path=logo_path,
    )

    candidate_name = structured_data.get("candidate_info", {}).get("full_name", "resume")
    safe_name = candidate_name.encode("ascii", "ignore").decode("ascii").strip() or "resume"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_resume.pdf"'},
    )


@router.get("/{craft_id}/scorecard-pdf")
async def download_scorecard_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """Download ScorQ scorecard as PDF (matches existing ScorQ format)."""
    _get_user(authorization)
    craft, score, job = _fetch_craft_and_score(craft_id)

    candidate = score.get("candidates", {})
    craft_settings = craft.get("craft_settings", {})
    logo_path = craft_settings.get("logo_storage_path")

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
    )

    safe_name = candidate.get("name", "scorecard").encode("ascii", "ignore").decode("ascii").strip()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_scorecard.pdf"'},
    )


@router.get("/{craft_id}/combined-pdf")
async def download_combined_pdf(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Combined PDF: crafted resume pages + full scorecard as last page.
    Action items are NOT included — they're internal-only.
    """
    _get_user(authorization)
    craft, score, job = _fetch_craft_and_score(craft_id)

    structured_data = craft.get("structured_data", {})
    candidate = score.get("candidates", {})
    craft_settings = craft.get("craft_settings", {})
    mask = craft_settings.get("mask_pi", False)
    logo_path = craft_settings.get("logo_storage_path")

    pdf_bytes = generate_combined_pdf(
        # Resume data
        resume_data=structured_data,
        company_name=craft_settings.get("company_name", "HYROI Solutions"),
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
        logo_path=logo_path,
    )

    safe_name = candidate.get("name", "candidate").encode("ascii", "ignore").decode("ascii").strip()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}_scorcraft.pdf"'
        },
    )
