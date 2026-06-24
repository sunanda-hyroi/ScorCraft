from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class JDCreate(BaseModel):
    """Payload for creating/updating a job.

    Mirrors the real `job_descriptions` table columns (must/good/bonus skill
    arrays + per-category weight_* ints), NOT the old required_skills/
    scoring_weights shape — those were never columns and made inserts fail
    with PostgREST PGRST204 ("could not find the 'created_by' column ...").
    """
    title: str
    description: str = ""
    company: str = ""
    location: str = ""
    must_have_skills: List[str] = []
    good_to_have_skills: List[str] = []
    bonus_skills: List[str] = []
    # jsonb: {skill: [alias, ...]} — consumed by the technical scorer.
    skill_aliases: Dict[str, List[str]] = {}
    weight_technical: int = 40
    weight_experience: int = 25
    weight_education: int = 15
    weight_soft_skills: int = 10
    weight_stability: int = 10
    shortlist_threshold: int = 75
    review_threshold: int = 55


class JDResponse(BaseModel):
    id: str
    title: str
    description: str
    required_skills: List[Dict]
    nice_to_have_skills: List[str]
    skill_importance: Dict[str, str]
    experience_min: int
    experience_max: int
    education_required: str
    scoring_weights: Dict[str, Any]
    custom_instructions: str
    minimum_technical_score: Optional[int]
    shortlist_threshold: int
    review_threshold: int
    status: str
    created_at: str


class CategoryScore(BaseModel):
    score: int
    reasoning: str


class ScoreResponse(BaseModel):
    id: str
    candidate_name: str
    candidate_email: Optional[str]
    candidate_phone: Optional[str]
    overall_score: int
    recommendation: str
    category_scores: Dict[str, CategoryScore]
    matched_skills: List[str]
    missing_skills: List[str]
    red_flags: List[str]
    highlights: List[str]
    ai_reasoning: str
    model_used: str
    tokens_used: int
    scored_at: str


class ScoreRequest(BaseModel):
    job_id: str
    session_id: Optional[str] = None
