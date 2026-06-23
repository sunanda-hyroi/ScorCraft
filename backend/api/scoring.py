"""
Scoring endpoints — hybrid rule engine + AI pipeline.
"""
import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header
from typing import Optional, List
from db.supabase_client import supabase
from services.text_extractor import extract_text
from services.contact_parser import extract_contact_info
from services.scorer import score_resume
from config import settings

router = APIRouter(prefix="/api/v1/scoring", tags=["scoring"])


def _get_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _score_single(file_content: bytes, filename: str, job: dict, session_id: Optional[str] = None) -> dict:
    success, text = extract_text(file_content, filename)
    if not success:
        raise ValueError(text)
    text = text.replace("\x00", "").replace("\u0000", "")
    contact = extract_contact_info(text)
    candidate_name = contact.get("name") or _name_from_filename(filename)
    scored = await score_resume(text, job, candidate_name)
    tokens_used = scored.get("tokens_used", 0)
    storage_path = None
    try:
        storage_path = f"{job['id']}/{uuid.uuid4()}_{filename}"
        supabase.storage.from_(settings.RESUME_STORAGE_BUCKET).upload(storage_path, file_content)
    except Exception:
        pass
    candidate_res = supabase.table("candidates").insert({
        "name": candidate_name,
        "email": contact.get("email"),
        "phone": contact.get("phone"),
        "resume_filename": filename,
        "resume_storage_path": storage_path,
    }).execute()
    candidate_id = candidate_res.data[0]["id"]
    score_res = supabase.table("scores").insert({
        "candidate_id": candidate_id,
        "job_id": job["id"],
        "session_id": session_id,
        "overall_score": scored["overall_score"],
        "recommendation": scored["recommendation"],
        "category_scores":  scored["category_scores"],
        "matched_skills":   scored["matched_skills"],
        "skills_to_verify": scored.get("skills_to_verify", []),
        "missing_skills": scored["missing_skills"],
        "red_flags": scored["red_flags"],
        "highlights": scored["highlights"],
        "ai_reasoning": (scored["ai_reasoning"] or "").replace("\x00", ""),
        "model_used": settings.AI_PROVIDER,
        "tokens_used": tokens_used,
        "resume_raw_text": text[:5000].replace("\x00", ""),
    }).execute()
    if session_id:
        try:
            cur = supabase.table("scoring_sessions").select("completed,total_tokens_used").eq("id", session_id).execute()
            if cur.data:
                row = cur.data[0]
                supabase.table("scoring_sessions").update({
                    "completed": (row.get("completed") or 0) + 1,
                    "total_tokens_used": (row.get("total_tokens_used") or 0) + tokens_used,
                }).eq("id", session_id).execute()
        except Exception:
            pass
    return {
        "score_id": score_res.data[0]["id"],
        "candidate_name": candidate_name,
        "candidate_email": contact.get("email"),
        "candidate_phone": contact.get("phone"),
        "overall_score": scored["overall_score"],
        "recommendation": scored["recommendation"],
        "category_scores":  scored["category_scores"],
        "matched_skills":   scored["matched_skills"],
        "skills_to_verify": scored.get("skills_to_verify", []),
        "missing_skills": scored["missing_skills"],
        "red_flags": scored["red_flags"],
        "highlights": scored["highlights"],
        "ai_reasoning": scored["ai_reasoning"],
        "model_used": settings.AI_PROVIDER,
        "tokens_used": tokens_used,
    }


@router.post("/single")
async def score_single(file: UploadFile = File(...), job_id: str = Form(...), authorization: Optional[str] = Header(None)):
    _get_user(authorization)
    job_res = supabase.table("job_descriptions").select("*").eq("id", job_id).execute()
    if not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        content = await file.read()
        return await _score_single(content, file.filename, job_res.data[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch")
async def score_batch(files: List[UploadFile] = File(...), job_id: str = Form(...), batch_name: str = Form(""), authorization: Optional[str] = Header(None)):
    _get_user(authorization)
    job_res = supabase.table("job_descriptions").select("*").eq("id", job_id).execute()
    if not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    job = job_res.data[0]
    session_res = supabase.table("scoring_sessions").insert({
        "job_id": job_id,
        "batch_name": batch_name or f"Batch {len(files)} resumes",
        "total_resumes": len(files),
        "completed": 0,
        "failed": 0,
        "model_used": settings.AI_PROVIDER,
    }).execute()
    session_id = session_res.data[0]["id"]
    results, errors = [], []
    file_data = []
    for file in files:
        try:
            file_bytes = await file.read()
            file_data.append((file_bytes, file.filename))
            print(f"Read: {file.filename} ({len(file_bytes)} bytes)")
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})
    for file_bytes, filename in file_data:
        try:
            print(f"Scoring: {filename}")
            result = await _score_single(file_bytes, filename, job, session_id)
            results.append(result)
        except Exception as e:
            import traceback
            print(f"ERROR {filename}: {str(e)}")
            print(traceback.format_exc())
            errors.append({"filename": filename, "error": str(e)})
    try:
        supabase.table("scoring_sessions").update({"completed_at": "now()"}).eq("id", session_id).execute()
    except Exception:
        pass
    return {"session_id": session_id, "total": len(files), "scored": len(results), "failed": len(errors), "results": results, "errors": errors}


def _name_from_filename(filename: str) -> str:
    import os
    base = os.path.splitext(filename)[0]
    name = base.replace("_", " ").replace("-", " ").strip()
    words = [w for w in name.split() if w.lower() not in ("resume", "cv", "curriculum", "vitae")]
    return " ".join(words).title() or "Unknown"
