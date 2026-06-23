/**
 * Mappers between backend API shapes and the UI's candidate object.
 *
 * The UI component (ScorCraft.jsx) uses a flat candidate shape inherited from
 * the prototype's mock data. The backend returns:
 *   - scoring: category_scores as { technical: {score, reasoning}, ... }
 *   - crafting: structured_data with employment_history (nested) etc.
 * These functions convert in both directions so the existing UI renders
 * real data unchanged.
 */
import type { ScoreResult, CraftResult } from "./api";

const CAT_KEYS = ["technical", "experience", "education", "stability"] as const;

/** Backend ScoreResult → UI candidate (results table + scorecard fields). */
export function scoreResultToCandidate(r: ScoreResult): Record<string, unknown> {
  const categories: Record<string, number | null> = {};
  const catReasoning: Record<string, string> = {};
  for (const k of CAT_KEYS) {
    const c = r.category_scores?.[k];
    categories[k] = c && typeof c.score === "number" ? c.score : null;
    catReasoning[k] = c?.reasoning || "";
  }

  // Derive a skillDetails list from matched/missing for the scorecard view.
  const skillDetails = [
    ...(r.matched_skills || []).map((s) => ({
      skill: s,
      found: true,
      where: "Found in resume",
      level: "—",
    })),
    ...(r.missing_skills || []).map((s) => ({
      skill: s,
      found: false,
      where: "Not found",
      level: "—",
    })),
  ];

  // Action items (internal-only) seed from red flags + missing must-haves.
  const gaps = [
    ...(r.red_flags || []),
    ...(!r.candidate_email ? ["Email missing"] : []),
    ...(!r.candidate_phone ? ["Phone number missing"] : []),
  ];

  return {
    id: r.score_id,
    scoreId: r.score_id,
    name: r.candidate_name || "Unknown",
    email: r.candidate_email,
    phone: r.candidate_phone,
    location: null,
    score: r.overall_score ?? 0,
    categories,
    catReasoning,
    matched: r.matched_skills || [],
    missing: r.missing_skills || [],
    highlights: r.highlights || [],
    redFlags: r.red_flags || [],
    gaps,
    reasoning: r.ai_reasoning || "",
    skillDetails,
    // These populate after crafting (structured_data); empty until then.
    employment: [],
    education: [],
    certifications: [],
    executive_summary: [],
    core_competencies: [],
    technical_competencies: {},
    crafted: false,
  };
}

/** structured_data.employment_history (nested) → UI `employment`. */
function employmentFromStructured(eh: any[]): unknown[] {
  return (eh || []).map((emp) => ({
    company: emp.company || "",
    role: emp.role || "",
    duration: emp.duration || "",
    location: emp.location || "",
    projects: (emp.projects || []).map((p: any) => ({
      name: p.project_name || p.name || "",
      duration: p.duration || "",
      responsibilities: p.responsibilities || [],
      skills: p.technical_skills || p.skills || "",
    })),
  }));
}

/** UI `employment` → structured_data.employment_history (for editor save). */
function employmentToStructured(employment: any[]): unknown[] {
  return (employment || []).map((emp) => ({
    company: emp.company || "",
    role: emp.role || "",
    duration: emp.duration || "",
    location: emp.location || "",
    projects: (emp.projects || []).map((p: any) => ({
      project_name: p.name || "",
      duration: p.duration || "",
      responsibilities: p.responsibilities || [],
      technical_skills: p.skills || "",
    })),
  }));
}

/**
 * Merge a CraftResult's structured_data into an existing UI candidate,
 * filling the resume-detail fields and marking it crafted.
 */
export function applyCraftResult(
  candidate: Record<string, unknown>,
  craft: CraftResult
): Record<string, unknown> {
  const sd = (craft.structured_data || {}) as any;
  const info = sd.candidate_info || {};
  return {
    ...candidate,
    craftId: craft.craft_id,
    crafted: true,
    missingReport: craft.missing_report,
    name: info.full_name || candidate.name,
    email: craft.candidate_email ?? info.email ?? candidate.email,
    phone: craft.candidate_phone ?? info.phone ?? candidate.phone,
    location: info.current_location || info.location || candidate.location,
    executive_summary: sd.executive_summary || [],
    core_competencies: sd.core_competencies || [],
    employment: employmentFromStructured(sd.employment_history || []),
    education: sd.education || [],
    certifications: sd.certifications || [],
    technical_competencies: sd.technical_competencies || {},
  };
}

/** UI candidate (after editing) → structured_data for PUT /craft/:id. */
export function candidateToStructured(c: any): Record<string, unknown> {
  return {
    candidate_info: {
      full_name: c.name || "",
      email: c.email || null,
      phone: c.phone || null,
      location: c.location || null,
      current_location: c.location || null,
    },
    executive_summary: c.executive_summary || [],
    core_competencies: c.core_competencies || [],
    employment_history: employmentToStructured(c.employment || []),
    education: c.education || [],
    certifications: c.certifications || [],
    technical_competencies: c.technical_competencies || {},
  };
}

/** Build CraftSettings from the UI letterhead + maskPI toggle. */
export function craftSettingsFrom(
  letterhead: { company?: string; tagline?: string; email?: string; phone?: string },
  maskPI: boolean
) {
  return {
    mask_pi: maskPI,
    company_name: letterhead.company || "HYROI Solutions",
    company_tagline: letterhead.tagline,
    company_email: letterhead.email,
    company_phone: letterhead.phone,
  };
}
