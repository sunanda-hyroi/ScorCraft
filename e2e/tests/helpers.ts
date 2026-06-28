import { Page, APIRequestContext, expect } from "@playwright/test";
import * as path from "path";

export const BACKEND = "https://recruitcraft.up.railway.app";
export const FIXTURES = path.join(__dirname, "..", "fixtures");

export const RESUMES = {
  rohan: path.join(FIXTURES, "01_Rohan_Verma_Strong_Match.pdf"),
  karthik: path.join(FIXTURES, "03_Karthik_Subramanian_Partial_Match_Missing3.pdf"),
  deepa: path.join(FIXTURES, "04_Deepa_Krishnan_Weak_Match_Missing5.pdf"),
  amit: path.join(FIXTURES, "05_Amit_Joshi_No_Match.pdf"),
  vikram: path.join(FIXTURES, "07_Vikram_Mehta_Alias_Test.pdf"),
};

export function uniqueTitle(prefix = "PW Test Engineer") {
  return `${prefix} ${Date.now()}`;
}

/** Mint a Supabase access token for the test account (for API-based setup). */
export async function supabaseToken(request: APIRequestContext): Promise<string> {
  const url = process.env.SUPABASE_URL!.replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY!;
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email: "playwright@hyroi.com", password: "PlayTest1234!" },
  });
  expect(res.ok(), `supabase token: ${res.status()}`).toBeTruthy();
  return (await res.json()).access_token as string;
}

/**
 * Create a job directly via the backend API (fast, no OpenAI) — used to seed
 * prerequisites for the heavier specs. Returns the created job id + title.
 */
export async function apiCreateJob(
  request: APIRequestContext,
  token: string,
  opts: { title: string; must?: string[]; good?: string[] }
): Promise<{ id: string; title: string }> {
  const required_skills = [
    ...(opts.must || []).map((skill) => ({ skill, importance: "must" })),
    ...(opts.good || []).map((skill) => ({ skill, importance: "good" })),
  ];
  const res = await request.post(`${BACKEND}/api/v1/jobs`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { title: opts.title, description: "", required_skills },
  });
  expect(res.ok(), `create job: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return { id: body.job.id, title: body.job.title };
}

/** Land on the dashboard (jobs list) with the session restored. */
export async function gotoDashboard(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Either the Jobs dashboard or its empty state ("No jobs yet") shows.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
}

/** Click a job card by its exact title → advances to the Upload step. */
export async function selectJob(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  // The dropzone copy is unique to the Upload step ("Upload resumes" also
  // appears in the always-present step bar, so it isn't a reliable signal).
  await expect(page.getByText(/Drop resumes here or click to browse/)).toBeVisible({ timeout: 30_000 });
}

/** Upload one or more resume files via the dropzone file chooser. */
export async function uploadResumes(page: Page, files: string[]) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByText(/click to browse|files ready/).first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

/** Click the "Score N resumes" button and wait for the results view. */
export async function runScoringAndWait(page: Page) {
  await page.getByRole("button", { name: /Score \d+ resume/ }).click();
  // Results view is reached when the cutoff control appears (up to 90s OpenAI).
  await expect(page.getByText("Cutoff:")).toBeVisible({ timeout: 100_000 });
}

/** The candidate row container for a given name (has the name + SCORE badge). */
export function candidateRow(page: Page, name: string) {
  return page
    .locator("div")
    .filter({ hasText: name })
    .filter({ hasText: "SCORE" })
    .last();
}

/** Read a candidate's overall score from their results row (first number). */
export async function readScore(page: Page, name: string): Promise<number> {
  const row = candidateRow(page, name);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const txt = await row.innerText();
  const m = txt.match(/\b(\d{1,3})\b/);
  expect(m, `no score number found in row for ${name}`).not.toBeNull();
  return Number(m![1]);
}

/**
 * Full seed via UI: select an API-created job, upload the given resumes, score.
 * Leaves the page on the results step.
 */
export async function seedScored(
  page: Page,
  request: APIRequestContext,
  files: string[],
  titlePrefix: string,
  skills?: { must?: string[]; good?: string[] }
): Promise<string> {
  const token = await supabaseToken(request);
  const title = uniqueTitle(titlePrefix);
  await apiCreateJob(page.request, token, {
    title,
    must: skills?.must || ["Python", "SQL", "Spark"],
    good: skills?.good || ["AWS", "Docker"],
  });
  await gotoDashboard(page);
  await selectJob(page, title);
  await uploadResumes(page, files);
  await runScoringAndWait(page);
  return title;
}
