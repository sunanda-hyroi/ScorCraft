"""
Alias Suggester — uses OpenAI to suggest aliases and equivalents for a skill.
Called when recruiter adds a skill to the JD.
"""
from __future__ import annotations
import json
import re
from services.ai.router import get_adapter

SYSTEM_PROMPT = """You are a technical recruiting expert.
Given a skill name, suggest:
1. ALIASES — different names/abbreviations for the exact same skill (100% equivalent)
2. EQUIVALENTS — similar skills that partially satisfy the requirement (90% equivalent)

Rules:
- Aliases: must be genuinely the same skill (e.g. JS = JavaScript, UX Research = User Research)
- Equivalents: must be meaningfully related tools/skills in the same category
- Maximum 5 aliases, maximum 5 equivalents
- Do not include the original skill name
- Keep names short and clean
- Return ONLY JSON, no explanation

Return format:
{
  "aliases": ["name1", "name2"],
  "equivalents": ["name3", "name4"]
}"""


async def suggest_aliases(skill: str) -> dict:
    """
    Suggest aliases and equivalents for a skill using AI.
    Returns { aliases: [...], equivalents: [...] }
    """
    if not skill or len(skill.strip()) < 2:
        return {"aliases": [], "equivalents": []}

    try:
        from openai import AsyncOpenAI
        from config import settings
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Suggest aliases and equivalents for: {skill.strip()}"},
            ],
            max_tokens=300,
            temperature=0.2,
        )
        raw = response.choices[0].message.content or ""
        _ = 0

        cleaned = raw.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)

        data = json.loads(cleaned)
        return {
            "aliases":     [s.strip() for s in data.get("aliases", []) if s.strip()],
            "equivalents": [s.strip() for s in data.get("equivalents", []) if s.strip()],
        }
    except Exception as e:
        print(f"Alias suggestion error for '{skill}': {e}")
        return {"aliases": [], "equivalents": []}
