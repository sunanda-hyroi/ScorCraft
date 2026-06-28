import { test, expect } from "@playwright/test";
import {
  apiCreateJob,
  gotoDashboard,
  readScore,
  RESUMES,
  runScoringAndWait,
  selectJob,
  supabaseToken,
  uniqueTitle,
  uploadResumes,
} from "./helpers";

let jobTitle = "";

test.beforeAll(async ({ request }) => {
  const token = await supabaseToken(request);
  jobTitle = uniqueTitle("PW Score");
  await apiCreateJob(request, token, {
    title: jobTitle,
    must: ["Python", "SQL", "Spark"],
    good: ["AWS", "Docker"],
  });
});

test("U1: upload a single resume", async ({ page }) => {
  await gotoDashboard(page);
  await selectJob(page, jobTitle);
  await uploadResumes(page, [RESUMES.rohan]);
  await expect(page.getByText("01_Rohan_Verma_Strong_Match.pdf")).toBeVisible();
});

test("U2: upload a batch of resumes", async ({ page }) => {
  await gotoDashboard(page);
  await selectJob(page, jobTitle);
  await uploadResumes(page, [RESUMES.rohan, RESUMES.karthik, RESUMES.deepa, RESUMES.amit, RESUMES.vikram]);
  await expect(page.getByText("5 files ready")).toBeVisible();
});

test("U5: supported-formats note is shown", async ({ page }) => {
  await gotoDashboard(page);
  await selectJob(page, jobTitle);
  await expect(page.getByText(/Supported formats: PDF, DOCX/)).toBeVisible();
});

test("S2-S5: score a batch and verify results", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoDashboard(page);
  await selectJob(page, jobTitle);
  await uploadResumes(page, [RESUMES.rohan, RESUMES.karthik, RESUMES.deepa, RESUMES.amit, RESUMES.vikram]);

  // S5: progress UI appears while scoring runs.
  await page.getByRole("button", { name: /Score \d+ resume/ }).click();
  await expect(page.getByText(/Scoring resumes/)).toBeVisible({ timeout: 15_000 });

  // S2: results appear with candidates listed.
  await expect(page.getByText("Cutoff:")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Rohan Verma")).toBeVisible();
  await expect(page.getByText("Amit Joshi")).toBeVisible();

  // S3: strong match scores high; S4: no match scores low.
  expect(await readScore(page, "Rohan Verma")).toBeGreaterThanOrEqual(60);
  expect(await readScore(page, "Amit Joshi")).toBeLessThan(50);
});
