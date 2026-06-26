/**
 * ScorCraft API client.
 *
 * Wraps fetch calls to the FastAPI backend. In development, requests go to
 * relative `/api/...` paths which next.config.mjs proxies to the backend
 * (default http://localhost:8000); override with NEXT_PUBLIC_API_BASE.
 *
 * Degraded / demo mode
 * --------------------
 * The backend boots without Supabase/OpenAI credentials (degraded mode) and
 * every data endpoint requires a Supabase Bearer token. When credentials are
 * missing, or the token is absent/invalid, or the backend is unreachable, the
 * call throws `DemoModeError`. Components catch it and fall back to mock data,
 * showing the "demo mode" banner. The canonical degraded signal is HTTP 503,
 * but we also treat 401/403/502/network failures and the `/health`
 * `configured: false` flag as "not live" so the demo works out of the box.
 */
import { supabase } from "./supabase";

// Known production backend (Railway). Used as a last-resort fallback in
// production builds so the app never silently drops to demo mode when the
// NEXT_PUBLIC_API_URL build-time var is missing/empty on Vercel.
const PROD_API_FALLBACK = "https://recruitcraft.up.railway.app";

// Absolute backend URL via NEXT_PUBLIC_API_URL, falling back to
// NEXT_PUBLIC_API_BASE. Trailing slashes are stripped so `${API_BASE}/api/...`
// never produces a double slash.
//
// Resolution order:
//   1. NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_BASE (explicit, build-time inlined)
//   2. production build with no explicit base → Railway backend (so prod is
//      never stuck in demo mode if the Vercel env var didn't get inlined)
//   3. otherwise "" → same-origin relative paths, proxied to localhost by
//      next.config.mjs in development (keeps Codespaces dev working)
export const API_BASE = (() => {
  const explicit = (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE ??
    ""
  ).replace(/\/+$/, "");
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? PROD_API_FALLBACK : "";
})();

/** Thrown when the backend can't serve a real response → use mock fallback. */
export class DemoModeError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "DemoModeError";
    this.status = status;
  }
}

/** Statuses that mean "backend is up but can't serve live data" → demo mode. */
const DEGRADED_STATUSES = new Set([401, 403, 500, 502, 503, 504]);

// ── Auth token ───────────────────────────────────────────────────
// Synchronous best-effort token: the last value persisted to localStorage.
// Used where async isn't possible (e.g. ScorCraft.jsx route guard). May be
// stale after Supabase auto-refreshes the access token — prefer getAuthToken()
// for actual API calls.
export function getToken(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("scorcraft_token");
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_DEV_TOKEN || "";
}

// Authoritative token for API calls: read the *live* Supabase session so we
// always send the current (auto-refreshed) access token. The token captured at
// login and stored in localStorage expires after ~1h while the session keeps a
// fresh one; sending the stale token is what caused the 401s in production.
export async function getAuthToken(): Promise<string> {
  if (typeof window !== "undefined") {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        // Keep the synchronous fallback in sync with the refreshed token.
        window.localStorage.setItem("scorcraft_token", token);
        return token;
      }
    } catch {
      /* fall through to the persisted/dev token */
    }
  }
  return getToken();
}

async function authHeaders(
  extra: Record<string, string> = {}
): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

// ── Health / configuration probe (cached) ────────────────────────
export interface HealthInfo {
  configured: boolean;
  supabase: boolean;
  openai: boolean;
}

let healthCache: Promise<HealthInfo> | null = null;

export function checkHealth(force = false): Promise<HealthInfo> {
  if (!healthCache || force) {
    healthCache = fetch(`${API_BASE}/health`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`health ${r.status}`);
        const d = await r.json();
        return {
          configured: !!d.configured,
          supabase: !!d.supabase,
          openai: !!d.openai,
        };
      })
      .catch(() => ({ configured: false, supabase: false, openai: false }));
  }
  return healthCache;
}

/** True when the backend is reachable AND has live credentials. */
export async function isLive(): Promise<boolean> {
  const h = await checkHealth();
  return h.configured;
}

// ── Core request helper ──────────────────────────────────────────
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: await authHeaders(init.headers as Record<string, string>),
    });
  } catch (e) {
    // Network failure / backend down → demo mode.
    throw new DemoModeError(`Network error: ${(e as Error).message}`, 0);
  }

  if (!res.ok) {
    if (DEGRADED_STATUSES.has(res.status)) {
      throw new DemoModeError(
        `Backend not available (HTTP ${res.status})`,
        res.status
      );
    }
    // Genuine client error (e.g. 400, 404, 422) — surface it.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Types (subset of backend shapes the UI consumes) ─────────────
export interface JobVersionRef {
  id: string;
  version: number;
  status?: string;
  created_at?: string;
}

export interface Job {
  id: string;
  title: string;
  company?: string;
  location?: string;
  description?: string;
  status?: string; // active | archived
  must_have_skills?: string[];
  good_to_have_skills?: string[];
  bonus_skills?: string[];
  required_skills?: Array<Record<string, unknown>>;
  nice_to_have_skills?: string[];
  skill_importance?: Record<string, string>;
  scoring_weights?: Record<string, number>;
  shortlist_threshold?: number;
  created_at?: string;
  created_by_name?: string | null;
  // Feature 2/3 annotations from GET /api/v1/jobs
  candidates_scored_count?: number;
  version?: number;
  parent_job_id?: string | null;
  previous_versions?: JobVersionRef[];
  [k: string]: unknown;
}

export interface CategoryScore {
  score: number | null;
  reasoning?: string;
}

export interface ScoreResult {
  score_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  overall_score: number;
  recommendation?: string;
  category_scores: Record<string, CategoryScore>;
  matched_skills: string[];
  missing_skills: string[];
  red_flags: string[];
  highlights: string[];
  ai_reasoning: string;
}

export interface BatchScoreResponse {
  session_id: string;
  total: number;
  scored: number;
  failed: number;
  results: ScoreResult[];
  errors: Array<{ filename: string; error: string }>;
}

export interface CraftSettings {
  mask_pi?: boolean;
  company_name?: string;
  company_tagline?: string;
  company_email?: string;
  company_phone?: string;
  logo_storage_path?: string;
}

export interface CraftResult {
  craft_id: string;
  score_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  overall_score: number;
  structured_data: Record<string, unknown>;
  missing_report: Record<string, unknown>;
  download_url: string;
  status: string;
}

export interface CraftBatchResponse {
  total: number;
  crafted: number;
  failed: number;
  results: CraftResult[];
  errors: Array<{ score_id: string; error: string }>;
}

export type DownloadKind =
  | "docx"
  | "resume-pdf"
  | "scorecard-pdf"
  | "combined-pdf";

// ── Endpoint wrappers ────────────────────────────────────────────

/** JobSelector → GET /api/v1/jobs (optionally filter by creator name). */
export async function listJobs(createdBy?: string): Promise<Job[]> {
  const qs = createdBy ? `?created_by=${encodeURIComponent(createdBy)}` : "";
  const data = await request<{ jobs: Job[] }>(`/api/v1/jobs${qs}`);
  return data.jobs || [];
}

/** JobSelector → POST /api/v1/jobs */
export async function createJob(job: Partial<Job>): Promise<Job> {
  const data = await request<{ job: Job }>("/api/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  return data.job;
}

/** JobDashboard edit → PUT /api/v1/jobs/:id (may create a new version) */
export async function updateJob(jobId: string, job: Partial<Job>): Promise<Job> {
  const data = await request<{ job: Job }>(`/api/v1/jobs/${jobId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  return data.job;
}

/** JobDashboard kebab → Duplicate → POST /api/v1/jobs/:id/duplicate.
 * Creates the next version in the lineage (version+1, parent = root) from the
 * edited form and archives the original. This IS the edit flow. */
export async function duplicateJob(jobId: string, job: Partial<Job>): Promise<Job> {
  const data = await request<{ job: Job }>(`/api/v1/jobs/${jobId}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  return data.job;
}

/** JobDashboard kebab → Archive (soft) → DELETE /api/v1/jobs/:id */
export async function archiveJob(jobId: string): Promise<void> {
  await request(`/api/v1/jobs/${jobId}`, { method: "DELETE" });
}

/** JobDashboard kebab → Delete (hard) → DELETE /api/v1/jobs/:id?hard=true.
 * Backend rejects (409) if candidates were scored against the job. */
export async function deleteJob(jobId: string): Promise<void> {
  await request(`/api/v1/jobs/${jobId}?hard=true`, { method: "DELETE" });
}

/** JobDashboard → GET /api/v1/jobs/:id (single job, e.g. to view a version) */
export async function getJob(jobId: string): Promise<Job> {
  const data = await request<{ job: Job }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
  return data.job;
}

/** JobCreator → POST /api/v1/jobs/extract-skills (JD text → skill list) */
export async function extractSkills(description: string): Promise<string[]> {
  const data = await request<{ skills: string[] }>("/api/v1/jobs/extract-skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return data.skills || [];
}

/** AliasPanel → POST /api/v1/jobs/suggest-aliases (skill → aliases + equivalents) */
export async function suggestAliases(
  skill: string
): Promise<{ aliases: string[]; equivalents: string[] }> {
  const data = await request<{ aliases?: string[]; equivalents?: string[] }>(
    "/api/v1/jobs/suggest-aliases",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill }),
    }
  );
  return { aliases: data.aliases || [], equivalents: data.equivalents || [] };
}

/** ResumeUploader → POST /api/v1/scoring/batch (multipart) */
export async function scoreBatch(
  files: File[],
  jobId: string,
  batchName = ""
): Promise<BatchScoreResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("job_id", jobId);
  form.append("batch_name", batchName);
  return request<BatchScoreResponse>("/api/v1/scoring/batch", {
    method: "POST",
    body: form,
  });
}

/**
 * ResultsTable → GET /api/v1/results?job_id=...
 * Note: the spec mentioned /results/session/:id, but the backend has no
 * per-session results route. Scored candidates are returned inline by
 * scoreBatch(); this fetches the persisted scores for a job (e.g. on reload).
 */
export async function getResults(jobId?: string): Promise<unknown[]> {
  const qs = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  const data = await request<{ results: unknown[] }>(`/api/v1/results${qs}`);
  return data.results || [];
}

/** CraftQueue → POST /api/v1/craft/single */
export async function craftSingle(
  scoreId: string,
  settings: CraftSettings = {}
): Promise<CraftResult> {
  return request<CraftResult>("/api/v1/craft/single", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score_id: scoreId, settings }),
  });
}

/** CraftQueue → POST /api/v1/craft/batch */
export async function craftBatch(
  scoreIds: string[],
  settings: CraftSettings = {}
): Promise<CraftBatchResponse> {
  return request<CraftBatchResponse>("/api/v1/craft/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score_ids: scoreIds, settings }),
  });
}

/** ResumeEditor save → PUT /api/v1/craft/:id (body = structured_data) */
export async function updateCraft(
  craftId: string,
  structuredData: Record<string, unknown>
): Promise<{ craft_id: string; status: string; missing_report: unknown; download_url: string }> {
  return request("/api/v1/craft/" + craftId, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(structuredData),
  });
}

/**
 * Authenticated file download: fetch a path as a blob (the Authorization header
 * means a plain <a href> won't work) and trigger a browser download.
 */
async function fetchAndSave(path: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: await authHeaders() });
  } catch (e) {
    throw new DemoModeError(`Network error: ${(e as Error).message}`, 0);
  }
  if (!res.ok) {
    if (DEGRADED_STATUSES.has(res.status)) {
      throw new DemoModeError(`Download unavailable (HTTP ${res.status})`, res.status);
    }
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** DownloadModal (Craft stage) → GET /api/v1/download/:craftId/{kind} */
export async function downloadCraft(
  craftId: string,
  kind: DownloadKind,
  filename?: string
): Promise<void> {
  return fetchAndSave(
    `/api/v1/download/${craftId}/${kind}`,
    filename || `${craftId}.${kind.includes("pdf") ? "pdf" : "docx"}`
  );
}

/**
 * Review & Filter stage → GET /api/v1/download/score/:scoreId/scorecard-pdf
 * Generates the scorecard straight from the score record — no craft needed.
 */
export async function downloadScoreScorecard(
  scoreId: string,
  filename?: string
): Promise<void> {
  return fetchAndSave(
    `/api/v1/download/score/${scoreId}/scorecard-pdf`,
    filename || `${scoreId}_scorecard.pdf`
  );
}
