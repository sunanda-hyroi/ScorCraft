"""
Job Description endpoints — create, list, get, update, delete
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from models.schemas import JDCreate
from db.supabase_client import supabase

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


@router.get("")
async def list_jobs(authorization: Optional[str] = Header(None)):
    _get_user(authorization)
    try:
        res = supabase.table("job_descriptions")\
            .select("*")\
            .eq("status", "active")\
            .order("created_at", desc=True)\
            .execute()
        return {"jobs": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_job(
    jd: JDCreate,
    authorization: Optional[str] = Header(None)
):
    user_id = _get_user(authorization)
    try:
        data = jd.model_dump()
        data["created_by"] = user_id
        res = supabase.table("job_descriptions").insert(data).execute()
        return {"job": res.data[0]}
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
    jd: JDCreate,
    authorization: Optional[str] = Header(None)
):
    _get_user(authorization)
    try:
        res = supabase.table("job_descriptions")\
            .update(jd.model_dump())\
            .eq("id", job_id)\
            .execute()
        return {"job": res.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    authorization: Optional[str] = Header(None)
):
    _get_user(authorization)
    try:
        supabase.table("job_descriptions")\
            .update({"status": "archived"})\
            .eq("id", job_id)\
            .execute()
        return {"message": "Job archived"}
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
