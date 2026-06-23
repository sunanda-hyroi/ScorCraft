"""
JD Skills Extractor - extracts required skills from JD text using AI.
Runs once per JD, result cached in Supabase.
"""
from __future__ import annotations
import json
import re
from services.ai.router import get_adapter

EXTRACTION_PROMPT = """You are an ATS system. Extract ONLY the core technical skills and tools from this job description.

Rules:
- Include: specific tools, platforms, programming languages, frameworks, databases
- Include: certifications if explicitly required
- EXCLUDE: soft skills, domain knowledge metrics (like GWP, loss ratio, IBNR)
- EXCLUDE: generic terms like "communication", "teamwork", "analytical"
- EXCLUDE: methodologies unless very specific (e.g. "Agile" is ok, "problem solving" is not)
- Maximum 10 skills — pick the MOST IMPORTANT ones only
- Skills must be things you can literally search for in a resume

Return ONLY a JSON array. No explanation. No markdown.
Example: ["Power BI", "DAX", "Microsoft Fabric", "SQL", "Python"]

Job Description:
{jd_text}"""


async def extract_skills_from_jd(jd_text: str) -> list:
    if not jd_text or len(jd_text.strip()) < 50:
        return []
    try:
        from openai import AsyncOpenAI
        from config import settings
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        prompt = EXTRACTION_PROMPT.format(jd_text=jd_text[:4000])
        sys_msg = 'Extract skills from job descriptions. Return a JSON array only.'
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": prompt},
            ],
            max_tokens=500,
            temperature=0.1,
        )
        raw = response.choices[0].message.content or ""
        _ = 0
        cleaned = raw.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        data = json.loads(cleaned)
        # Handle both flat array and nested object responses
        if isinstance(data, list):
            skills = data
        elif isinstance(data, dict):
            # Extract from any nested list value
            skills = []
            for v in data.values():
                if isinstance(v, list):
                    skills.extend(v)
                    break
        else:
            skills = []
        
        if skills:
            return list(dict.fromkeys(
                s.strip() for s in skills
                if isinstance(s, str) and len(s.strip()) > 1
            ))
    except Exception as e:
        import traceback
        print(f"JD extraction error type: {type(e).__name__}")
        print(f"JD extraction error: {e}")
        print(traceback.format_exc())
    return []


def build_extracted_skill_importance(skills: list) -> tuple:
    required_skills  = []
    skill_importance = {}
    for i, skill in enumerate(skills):
        importance = "must" if i < 5 else "good"
        required_skills.append({"skill": skill, "importance": importance})
        skill_importance[skill] = importance
    return required_skills, skill_importance
