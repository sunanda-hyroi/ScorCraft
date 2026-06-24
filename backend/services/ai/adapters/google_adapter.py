"""
Google adapter — Gemini models
"""
from typing import Tuple
import google.generativeai as genai
from config import settings
from services.ai.adapters.base import BaseAdapter


class GoogleAdapter(BaseAdapter):
    def __init__(self):
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        self.model = genai.GenerativeModel(
            model_name=settings.GOOGLE_MODEL,
            generation_config={
                "temperature": settings.AI_TEMPERATURE,
                "max_output_tokens": settings.AI_MAX_TOKENS,
                "response_mime_type": "application/json",
            }
        )

    async def score(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> Tuple[str, int]:
        full_prompt = f"{system_prompt}\n\n{user_prompt}"
        response = self.model.generate_content(full_prompt)
        text = response.text or ""
        # Google doesn't always return token count — estimate
        tokens = len(full_prompt.split()) + len(text.split())
        return text, tokens
