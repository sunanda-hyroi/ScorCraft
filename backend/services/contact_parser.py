"""
Extract contact info from resume text.
Kept from Phase 1 — utility only.
"""
import re
from typing import Dict, Optional


def extract_contact_info(text: str) -> Dict[str, Optional[str]]:
    return {
        "name": _extract_name(text),
        "email": _extract_email(text),
        "phone": _extract_phone(text),
    }


def _extract_email(text: str) -> Optional[str]:
    m = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
    return m.group(0) if m else None


def _extract_phone(text: str) -> Optional[str]:
    for pattern in [
        r'\+?[\d]{1,3}[-.\s]?[\d]{3,5}[-.\s]?[\d]{3,5}[-.\s]?[\d]{3,5}',
        r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        r'\d{10}',
    ]:
        m = re.search(pattern, text)
        if m:
            digits = re.sub(r'\D', '', m.group(0))
            if len(digits) >= 10:
                return m.group(0)
    return None


def _extract_name(text: str) -> Optional[str]:
    NOISE_WORDS = [
        'resume', 'cv', 'curriculum', 'vitae', 'profile', 'summary',
        'objective', 'experience', 'education', 'skills', 'linkedin',
        'github', 'portfolio', 'contact', 'address', 'phone', 'email',
        'mobile', 'http', 'www', 'engineer', 'developer', 'manager',
        'analyst', 'designer', 'consultant', 'specialist', 'lead',
        'senior', 'junior', 'intern', 'fresher', 'candidate', 'page',
        'power', 'python', 'java', 'react', 'angular', 'tableau',
        'microsoft', 'google', 'amazon', 'oracle', 'salesforce',
    ]

    for line in text.strip().splitlines()[:10]:
        line = line.strip()
        if not line or len(line) > 60:
            continue

        # Strip LinkedIn, GitHub, URLs from line
        line = re.sub(r'\s*[\|•·]\s*linkedin.*$', '', line, flags=re.IGNORECASE)
        line = re.sub(r'\s*[\|•·]\s*github.*$', '', line, flags=re.IGNORECASE)
        line = re.sub(r'\s*[\|•·]\s*http.*$', '', line, flags=re.IGNORECASE)
        line = re.sub(r'\s*linkedin.*$', '', line, flags=re.IGNORECASE)
        line = re.sub(r'\s*github.*$', '', line, flags=re.IGNORECASE)
        line = re.sub(r'https?://\S+', '', line)
        line = line.strip()

        if not line or len(line) > 50:
            continue

        # Skip if contains email, phone, or long digit sequences
        if '@' in line or re.search(r'\d{4,}', line):
            continue

        # Names never contain commas or end with a period
        if ',' in line or line.endswith('.') or line.endswith(','):
            continue

        # Skip noise words
        lower = line.lower()
        if any(w in lower for w in NOISE_WORDS):
            continue

        # Only allow letters, spaces, hyphens
        if re.search(r'[^a-zA-Z\s\-]', line):
            continue

        # Must be 2-4 words
        words = line.split()
        if not (2 <= len(words) <= 4):
            continue

        # Every word must be purely alphabetic (hyphens allowed)
        if all(w.replace('-', '').isalpha() and len(w) >= 2 for w in words):
            return ' '.join(w.capitalize() for w in words)

    return None