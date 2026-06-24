"""
AI Processor — OpenAI-only resume extraction and rewriting.
Used by the crafting pipeline to convert raw resume text
into structured, polished JSON for document generation.
"""
import json
from openai import OpenAI
from config import settings


CORPORATE_EXTRACTION_PROMPT = '''You are an expert recruitment consultant and resume writer with 15+ years of experience. Your job is to extract, restructure and IMPROVE resume content to make it compelling for hiring managers.

CRITICAL RULES:
1. NEVER fabricate experience, skills, dates, or achievements not present in the original resume
2. DO rewrite content to be more impactful, clear and professional
3. DO fix grammar, passive voice, and weak language
4. DO make bullet points achievement-oriented where data exists
5. Return ONLY valid JSON, no markdown, no explanation

REWRITING GUIDELINES:
- Executive Summary: Rewrite as sharp 8-12 bullet points. Lead with years of experience and domain. Make each bullet specific and impactful.
- Responsibilities: Convert passive voice to active. "Responsible for testing" -> "Led QA testing for enterprise applications". Only use data/numbers if they exist in the original.
- Skills: Group logically, remove duplicates, standardise naming
- Always extract notice_period and current_location if mentioned anywhere

EMPLOYMENT HISTORY FORMAT:
- Group projects under their parent company/employer
- Each company entry should have: company name, role, overall duration, location
- Under each company, list individual projects with: project name, client (if different from company), duration, responsibilities, skills
- If the resume lists roles at different companies, keep them separate
- If multiple projects are listed under one company, nest them correctly

CERTIFICATIONS:
- Extract each certification with: name, issuing authority, expiry date (if mentioned)
- If expiry date is NOT mentioned, set expiry to null — this is a flag for the recruiter to verify

Return this exact JSON structure:

{
  "candidate_info": {
    "full_name": "string",
    "phone": "string or null",
    "email": "string or null",
    "location": "string or null",
    "current_location": "string or null",
    "linkedin": "string or null",
    "total_experience_years": "number or null",
    "notice_period": "string or null"
  },
  "executive_summary": [
    "8-12 sharp bullet points"
  ],
  "core_competencies": [
    {
      "domain": "Domain area",
      "skills": "Skill 1, Skill 2",
      "tools": "Tool 1, Tool 2"
    }
  ],
  "employment_history": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "duration": "Start - End",
      "location": "City or null",
      "projects": [
        {
          "project_name": "Project Name",
          "client": "Client name or null",
          "duration": "Start - End",
          "description": "1-2 sentence description",
          "responsibilities": [
            "Action-oriented bullet points, max 7"
          ],
          "technical_skills": "Skill A, Skill B"
        }
      ]
    }
  ],
  "education": [
    {
      "level": "Graduation or Post Graduation or Diploma",
      "degree": "Degree name",
      "institution": "University/College name",
      "year": "Year or null"
    }
  ],
  "certifications": [
    {
      "name": "Certification name",
      "issuer": "Issuing authority",
      "expiry": "Date string or null"
    }
  ],
  "technical_competencies": {
    "programming_languages": "Language 1, Language 2 or null",
    "tools_technologies": "Tool 1, Tool 2 or null",
    "platforms": "Platform 1, Platform 2 or null"
  },
  "missing_critical_info": [
    "Notice period not mentioned",
    "Current location not specified"
  ]
}

PAGE DISCIPLINE:
- Executive summary: 8-12 bullets maximum
- Projects: max 7 bullets per project, max 6 projects total
- Keep most recent/relevant if more exist

RESUME TEXT:
'''


def extract_and_structure_resume(
    resume_text: str,
    job_description: str = None,
) -> dict:
    """
    Extract and restructure resume using OpenAI.
    Returns structured JSON for document generation.
    """
    try:
        client = OpenAI(api_key=settings.OPENAI_API_KEY)

        truncated = resume_text[:8000] if len(resume_text) > 8000 else resume_text
        prompt = CORPORATE_EXTRACTION_PROMPT + truncated

        if job_description:
            jd_truncated = job_description[:2000]
            prompt += (
                f"\n\nJOB DESCRIPTION (align summary and highlight relevant "
                f"skills — do NOT fabricate anything):\n{jd_truncated}"
            )

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a precise resume parser and expert rewriter. Return only valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=settings.CRAFT_TEMPERATURE,
            max_tokens=settings.CRAFT_MAX_TOKENS,
            response_format={"type": "json_object"},
        )

        response_text = response.choices[0].message.content or ""

        # Parse JSON
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}")
        if start_idx == -1 or end_idx == -1:
            return {
                "success": False,
                "error": "No JSON found in AI response",
                "raw_response": response_text[:500],
            }

        structured_data = json.loads(response_text[start_idx : end_idx + 1])

        # Backward compatibility: convert employment_history → project_experience
        # if frontend expects the old format
        if "employment_history" in structured_data and "project_experience" not in structured_data:
            flat_projects = []
            for emp in structured_data["employment_history"]:
                for proj in emp.get("projects", []):
                    flat_projects.append({
                        **proj,
                        "company": emp.get("company"),
                        "role": emp.get("role"),
                    })
            structured_data["project_experience"] = flat_projects

        missing_report = generate_missing_report(structured_data)

        return {
            "success": True,
            "data": structured_data,
            "missing_report": missing_report,
            "provider": "openai",
            "tokens_used": response.usage.total_tokens if response.usage else 0,
        }

    except json.JSONDecodeError as e:
        return {"success": False, "error": f"JSON parse error: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def generate_missing_report(data: dict) -> dict:
    """Generate action items / missing info report for recruiters (internal only)."""
    missing = []
    warnings = []

    info = data.get("candidate_info", {})
    if not info:
        missing.append("Candidate information not found")
    else:
        if not info.get("full_name"):
            missing.append("Candidate name not found")
        if not info.get("email"):
            missing.append("Email address missing")
        if not info.get("phone"):
            missing.append("Phone number missing")
        if not info.get("total_experience_years"):
            warnings.append("Total experience years not specified")
        if not info.get("notice_period"):
            missing.append("Notice period not mentioned — ask candidate")
        if not info.get("current_location"):
            missing.append("Current location not specified — ask candidate")
        if not info.get("linkedin"):
            missing.append("LinkedIn profile missing — ask candidate")

    summary = data.get("executive_summary", [])
    if not summary:
        missing.append("No professional summary found")
    elif len(summary) < 5:
        warnings.append(f"Summary has only {len(summary)} points (recommend 8-12)")

    # Check certifications for missing expiry
    certs = data.get("certifications", [])
    if isinstance(certs, list):
        for cert in certs:
            if isinstance(cert, dict) and not cert.get("expiry"):
                warnings.append(f"Certification '{cert.get('name', 'Unknown')}' — expiry date missing, verify validity")
    if not certs:
        warnings.append("No certifications listed")

    education = data.get("education", [])
    if not education:
        missing.append("No education information found")

    employment = data.get("employment_history", [])
    projects = data.get("project_experience", [])
    if not employment and not projects:
        missing.append("No work experience found")

    return {
        "has_critical_missing": len(missing) > 0,
        "missing_sections": missing,
        "warnings": warnings,
        "completeness_score": max(0, 100 - (len(missing) * 15) - (len(warnings) * 5)),
    }
