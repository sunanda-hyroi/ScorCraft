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

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE !== undefined
    ? process.env.NEXT_PUBLIC_API_BASE
    : ""; // "" → relative paths, proxied by Next rewrites

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
// The prototype has no login flow yet. Supply a Supabase access token via
// localStorage("scorcraft_token") or NEXT_PUBLIC_DEV_TOKEN to exercise live
// endpoints; without one, authenticated calls fall back to demo mode.
export function getToken(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("scorcraft_token");
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_DEV_TOKEN || "";
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
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
      headers: authHeaders(init.headers as Record<string, string>),
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
export interface Job {
  id: string;
  title: string;
  required_skills?: Array<Record<string, unknown>>;
  nice_to_have_skills?: string[];
  skill_importance?: Record<string, string>;
  scoring_weights?: Record<string, number>;
  shortlist_threshold?: number;
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

/** JobSelector → GET /api/v1/jobs */
export async function listJobs(): Promise<Job[]> {
  const data = await request<{ jobs: Job[] }>("/api/v1/jobs");
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
 * DownloadModal → GET /api/v1/download/:id/{kind}
 * Downloads require the Authorization header, so a plain <a href> won't work.
 * We fetch the file as a blob and trigger a browser download.
 */
export async function downloadCraft(
  craftId: string,
  kind: DownloadKind,
  filename?: string
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/download/${craftId}/${kind}`, {
      headers: authHeaders(),
    });
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
  a.download = filename || `${craftId}.${kind.includes("pdf") ? "pdf" : "docx"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
