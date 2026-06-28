"""
Download endpoints — generate and serve final documents.
Options:
  - Resume only (DOCX or PDF)
  - Scorecard only (PDF)
  - Combined: resume + scorecard as last page (PDF)

Action items are NEVER included in downloads — they're internal-only.
"""
import logging
import time
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
from services.docx_generator import create_corporate_resume, create_combined_docx
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


# ── Performance caches ───────────────────────────────────────
# 1. In-process logo cache. The SAME logo file was being downloaded from
#    Storage on every single download (and several times within one combined
#    download). Caching the bytes for the process lifetime removes that
#    per-download round-trip entirely. Keyed by storage path.
_LOGO_CACHE: dict = {}

# 2. Rendered-document cache. PDFs/combined-DOCX were regenerated from scratch
#    on every download (the slow path). Once rendered, the bytes are stored in
#    the formatted bucket under cache/ keyed by craft_id + kind, so a repeat
#    download is a single file serve instead of a full regeneration. The cache
#    is invalidated when a craft is edited (api/crafting.update_crafted_resume
#    calls invalidate_craft_cache). Output is deterministic per (craft_id, kind)
#    because every download uses the craft_settings stored on the craft record.
_CACHE_DIR = "cache"
# (kind → file extension) for the cacheable download kinds.
_CACHE_KINDS = {
    "docx": "docx",
    "resume-pdf": "pdf",
    "scorecard-pdf": "pdf",
    "combined-pdf": "pdf",
    "combined-docx": "docx",
}


def _cache_key(craft_id: str, kind: str) -> str:
    return f"{_CACHE_DIR}/{craft_id}.{kind}.{_CACHE_KINDS[kind]}"


def _serve_cached(craft_id: str, kind: str) -> Optional[bytes]:
    """Return the cached document bytes if present, else None."""
    try:
        content = supabase.storage.from_(settings.FORMATTED_BUCKET).download(
            _cache_key(craft_id, kind))
        if content:
            logger.info("[PERF] cache HIT for %s/%s (%d bytes)", craft_id, kind, len(content))
            return content
    except Exception:
        pass  # cache miss is normal — fall through to regeneration
    return None


def _store_cached(craft_id: str, kind: str, content: bytes, content_type: str) -> None:
    """Best-effort: persist a rendered document so future downloads serve it
    instead of regenerating. Never raises — a failed cache write must not break
    the download that's already succeeded."""
    path = _cache_key(craft_id, kind)
    bucket = supabase.storage.from_(settings.FORMATTED_BUCKET)
    try:
        try:
            bucket.remove([path])  # storage3 needs a clear path before re-upload
        except Exception:
            pass
        bucket.upload(path, content, {"content-type": content_type, "x-upsert": "true"})
    except Exception as e:
        logger.warning("Cache store failed for %s (%s)", path, e)


def invalidate_craft_cache(craft_id: str) -> None:
    """Drop every cached rendering for a craft. Called after an edit so the next
    download regenerates from the updated structured_data."""
    paths = [_cache_key(craft_id, k) for k in _CACHE_KINDS]
    try:
        supabase.storage.from_(settings.FORMATTED_BUCKET).remove(paths)
        logger.info("Invalidated rendered-document cache for craft %s", craft_id)
    except Exception as e:
        logger.info("Cache invalidation skipped for %s (%s)", craft_id, e)


def _fetch_logo_bytes(logo_path: Optional[str]) -> Optional[bytes]:
    """Download the user's uploaded logo for the PDF footer. The logo lives in
    the formatted-resumes bucket (path: logos/{user_id}_logo.png), saved there
    by the Craft Settings UI. If no logo was uploaded (logo_path is null) or it
    can't be fetched, return None so the footer renders company text only — a
    missing logo must never break a download. The bytes are cached in-process so
    repeated downloads don't re-hit Storage."""
    if not logo_path:
        logger.info("Logo fetch: craft_settings has no logo_storage_path — rendering without logo")
        return None
    if logo_path in _LOGO_CACHE:
        return _LOGO_CACHE[logo_path]
    try:
        content = supabase.storage.from_(settings.FORMATTED_BUCKET).download(logo_path)
        if content:
            _LOGO_CACHE[logo_path] = content
            logger.info("Logo fetch: '%s' from bucket '%s' OK (%d bytes)",
                        logo_path, settings.FORMATTED_BUCKET, len(content))
        else:
            logger.warning("Logo fetch: '%s' from bucket '%s' returned empty — rendering without logo",
                           logo_path, settings.FORMATTED_BUCKET)
        return content or None
    except Exception as e:
        logger.warning("Logo fetch: '%s' not found in bucket '%s' (%s) — rendering without logo",
                       logo_path, settings.FORMATTED_BUCKET, e)
        return None


def _company_kwargs(craft_settings: dict) -> dict:
    """Footer/company params shared by resume + combined PDFs. The footer shows
    company name + tagline only (email/phone are not in the PDF footer). Also
    carries the optional resume header/footer toggles."""
    return {
        "company_name": craft_settings.get("company_name", "HYROI Solutions"),
        "company_tagline": craft_settings.get("company_tagline"),
        "logo_path": _fetch_logo_bytes(craft_settings.get("logo_storage_path")),
        "include_header": craft_settings.get("include_header", True),
        "include_footer": craft_settings.get("include_footer", True),
    }


def _fetch_craft(craft_id: str) -> dict:
    """Fetch just the crafted_resumes record (single query). Enough for the
    resume-only downloads, which don't touch the score/job at all."""
    craft_res = supabase.table("crafted_resumes").select("*").eq("id", craft_id).execute()
    if not craft_res.data:
        raise HTTPException(status_code=404, detail="Crafted resume not found")
    return craft_res.data[0]


def _fetch_craft_and_score(craft_id: str) -> tuple:
    """Fetch crafted resume + its score (with candidate, one join) + its job.
    Three round-trips, needed only by the scorecard/combined downloads."""
    craft = _fetch_craft(craft_id)

    score_res = supabase.table("scores").select(
        "*, candidates(*)"
    ).eq("id", craft["score_id"]).execute()
    score = score_res.data[0] if score_res.data else {}

    job_res = supabase.table("job_descriptions").select("*").eq(
        "id", craft.get("job_id") or score.get("job_id", "")
    ).execute()
    job = job_res.data[0] if job_res.data else {}

    return craft, score, job


# ── Scorecard PDF straight from a score (no craft needed) ───
# Used at the Review & Filter stage, before any resume is crafted.

@router.get("/score/{score_id}/scorecard-pdf")
async def download_score_scorecard_pdf(
    score_id: str,
    authorization: Optional[str] = Header(None),
):
    """Generate the scorecard PDF directly from a score record — no craft_id
    required. (Three-segment path, so it never collides with the craft routes
    at /{craft_id}/scorecard-pdf.)"""
    try:
        _get_user(authorization)

        score_res = supabase.table("scores").select(
            "*, candidates(*)"
        ).eq("id", score_id).execute()
        if not score_res.data:
            raise HTTPException(status_code=404, detail=f"Score '{score_id}' not found.")
        score = score_res.data[0]
        candidate = score.get("candidates") or {}

        job = {}
        if score.get("job_id"):
            try:
                jr = supabase.table("job_descriptions").select("title").eq(
                    "id", score["job_id"]).execute()
                job = jr.data[0] if jr.data else {}
            except Exception:
                job = {}

        pdf_bytes = generate_scorecard_pdf(
            candidate_name=candidate.get("name", "Unknown"),
            candidate_email=candidate.get("email"),
            candidate_phone=candidate.get("phone"),
            overall_score=score.get("overall_score", 0),
            category_scores=score.get("category_scores", {}),
            matched_skills=score.get("matched_skills", []),
            missing_skills=score.get("missing_skills", []),
            highlights=score.get("highlights", []),
            red_flags=score.get("red_flags", []),
            ai_reasoning=score.get("ai_reasoning", ""),
            job_title=job.get("title", ""),
        )

        safe_name = (candidate.get("name") or "scorecard").encode(
            "ascii", "ignore").decode("ascii").strip() or "scorecard"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_scorecard.pdf"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Score scorecard PDF failed for score_id=%s", score_id)
        raise HTTPException(status_code=500, detail=f"Scorecard PDF download failed: {e}")


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
                logo_bytes=_fetch_logo_bytes(craft_settings.get("logo_storage_path")),
                company_tagline=craft_settings.get("company_tagline"),
                include_header=craft_settings.get("include_header", True),
                include_footer=craft_settings.get("include_footer", True),
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
        t0 = time.time()
        _get_user(authorization)

        cached = _serve_cached(craft_id, "resume-pdf")
        craft = _fetch_craft(craft_id)
        logger.info("[PERF] resume-pdf DB query: %.2fs", time.time() - t0)

        structured_data = craft.get("structured_data") or {}
        craft_settings = craft.get("craft_settings") or {}

        if cached is not None:
            pdf_bytes = cached
        else:
            pdf_bytes = generate_resume_pdf(
                data=structured_data,
                mask_contacts=craft_settings.get("mask_pi", False),
                **_company_kwargs(craft_settings),
            )
            logger.info("[PERF] resume-pdf PDF generation: %.2fs", time.time() - t0)
            _store_cached(craft_id, "resume-pdf", pdf_bytes, "application/pdf")

        candidate_info = structured_data.get("candidate_info") or {}
        candidate_name = candidate_info.get("full_name") or "resume"
        safe_name = candidate_name.encode("ascii", "ignore").decode("ascii").strip() or "resume"

        logger.info("[PERF] resume-pdf total: %.2fs", time.time() - t0)
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
        t0 = time.time()
        _get_user(authorization)

        cached = _serve_cached(craft_id, "scorecard-pdf")
        craft, score, job = _fetch_craft_and_score(craft_id)
        logger.info("[PERF] scorecard-pdf DB query: %.2fs", time.time() - t0)

        candidate = score.get("candidates") or {}
        craft_settings = craft.get("craft_settings") or {}
        structured_data = craft.get("structured_data") or {}

        if cached is not None:
            pdf_bytes = cached
        else:
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
            logger.info("[PERF] scorecard-pdf PDF generation: %.2fs", time.time() - t0)
            _store_cached(craft_id, "scorecard-pdf", pdf_bytes, "application/pdf")

        safe_name = (candidate.get("name") or "scorecard").encode("ascii", "ignore").decode("ascii").strip() or "scorecard"
        logger.info("[PERF] scorecard-pdf total: %.2fs", time.time() - t0)
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
        t0 = time.time()
        _get_user(authorization)

        cached = _serve_cached(craft_id, "combined-pdf")
        craft, score, job = _fetch_craft_and_score(craft_id)
        logger.info("[PERF] combined-pdf DB query: %.2fs", time.time() - t0)

        structured_data = craft.get("structured_data") or {}
        candidate = score.get("candidates") or {}
        craft_settings = craft.get("craft_settings") or {}
        mask = craft_settings.get("mask_pi", False)

        if cached is not None:
            pdf_bytes = cached
        else:
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
            logger.info("[PERF] combined-pdf PDF generation: %.2fs", time.time() - t0)
            _store_cached(craft_id, "combined-pdf", pdf_bytes, "application/pdf")

        safe_name = (candidate.get("name") or "candidate").encode("ascii", "ignore").decode("ascii").strip() or "candidate"
        logger.info("[PERF] combined-pdf total: %.2fs", time.time() - t0)
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


@router.get("/{craft_id}/combined-docx")
async def download_combined_docx(
    craft_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Combined DOCX: crafted resume pages + the scorecard rendered as a structured
    python-docx table page (last section). No pdf2image / poppler — pure tables.
    Action items are NOT included — they're internal-only.
    """
    try:
        t0 = time.time()
        _get_user(authorization)

        cached = _serve_cached(craft_id, "combined-docx")
        craft, score, job = _fetch_craft_and_score(craft_id)
        logger.info("[PERF] combined-docx DB query: %.2fs", time.time() - t0)

        structured_data = craft.get("structured_data") or {}
        candidate = score.get("candidates") or {}
        craft_settings = craft.get("craft_settings") or {}
        mask = craft_settings.get("mask_pi", False)

        if cached is not None:
            safe_name = (candidate.get("name") or "candidate").encode("ascii", "ignore").decode("ascii").strip() or "candidate"
            logger.info("[PERF] combined-docx total (cached): %.2fs", time.time() - t0)
            return Response(
                content=cached,
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                headers={"Content-Disposition": f'attachment; filename="{safe_name}_scorcraft.docx"'},
            )

        scorecard = {
            "candidate_name": candidate.get("name", "Unknown"),
            "candidate_email": None if mask else candidate.get("email"),
            "candidate_phone": None if mask else candidate.get("phone"),
            "overall_score": score.get("overall_score", 0),
            "category_scores": score.get("category_scores", {}),
            "matched_skills": score.get("matched_skills", []),
            "highlights": score.get("highlights", []),
            "ai_reasoning": score.get("ai_reasoning", ""),
            "job_title": job.get("title", ""),
        }

        docx_bytes = create_combined_docx(
            structured_data,
            scorecard,
            company_name=craft_settings.get("company_name", "HYROI Solutions"),
            mask_contacts=mask,
            logo_bytes=_fetch_logo_bytes(craft_settings.get("logo_storage_path")),
            company_tagline=craft_settings.get("company_tagline"),
            include_header=craft_settings.get("include_header", True),
            include_footer=craft_settings.get("include_footer", True),
        )
        logger.info("[PERF] combined-docx generation: %.2fs", time.time() - t0)
        _store_cached(craft_id, "combined-docx", docx_bytes,
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

        safe_name = (candidate.get("name") or "candidate").encode("ascii", "ignore").decode("ascii").strip() or "candidate"
        logger.info("[PERF] combined-docx total: %.2fs", time.time() - t0)
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}_scorcraft.docx"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Combined DOCX download failed for craft_id=%s", craft_id)
        raise HTTPException(status_code=500, detail=f"Combined DOCX download failed: {e}")
