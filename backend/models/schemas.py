from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class JDCreate(BaseModel):
    title: str
    description: str = ""
    required_skills: List[Dict] = []
    nice_to_have_skills: List[str] = []
    skill_importance: Dict[str, str] = {}
    experience_min: int = 0
    experience_max: int = 99
    education_required: str = ""
    scoring_weights: Dict[str, Any] = {
        "technical": 40,
        "experience": 25,
        "education": 10,
        "soft_skills": 15,
        "stability": 10
    }
    custom_instructions: str = ""
    minimum_technical_score: Optional[int] = None
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
