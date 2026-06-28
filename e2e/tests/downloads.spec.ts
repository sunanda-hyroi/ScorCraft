import { test, expect, Page } from "@playwright/test";
import {
  apiCreateJob,
  gotoDashboard,
  RESUMES,
  runScoringAndWait,
  selectJob,
  supabaseToken,
  uniqueTitle,
  uploadResumes,
} from "./helpers";

// One crafted candidate, shared across the download cases.
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  const token = await supabaseToken(request);
  const title = uniqueTitle("PW Downloads");
  await apiCreateJob(request, token, { title, must: ["Python", "SQL", "Spark"], good: ["AWS", "Docker"] });

  const context = await browser.newContext({ storageState: ".auth/state.json" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await gotoDashboard(page);
  await selectJob(page, title);
  await uploadResumes(page, [RESUMES.rohan]);
  await runScoringAndWait(page);
  await page.locator("label").filter({ hasText: /Select all/ }).getByRole("checkbox").check();
  await page.getByRole("button", { name: /Move to craft/ }).click();
  await page.getByRole("button", { name: "Craft resume" }).click();
  await expect(page.getByText(/Crafted ✓/)).toBeVisible({ timeout: 90_000 });
});

test.afterAll(async () => {
  await page?.close();
});

async function ensureModal() {
  if (!(await page.getByText(/^Download:/).isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByText(/^Download:/)).toBeVisible();
  }
}

// The option block containing a given label + format buttons.
function optBlock(label: string) {
  return page
    .locator("div")
    .filter({ hasText: label })
    .filter({ has: page.getByRole("button", { name: "PDF" }) })
    .last();
}

async function downloadFrom(label: string, format: "PDF" | "DOCX") {
  await ensureModal();
  const downloadPromise = page.waitForEvent("download");
  await optBlock(label).getByRole("button", { name: format }).click();
  return downloadPromise;
}

test("D6: loading indicator shows while generating", async () => {
  await ensureModal();
  // Click without awaiting so we can observe the in-flight banner.
  await optBlock("Combined: Resume + Scorecard").getByRole("button", { name: "PDF" }).click();
  await expect(page.getByText(/Generating your document/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Download complete/)).toBeVisible({ timeout: 60_000 });
});

test("D1: download resume PDF", async () => {
  const d = await downloadFrom("Resume only", "PDF");
  const dl = await d;
  expect(dl.suggestedFilename().toLowerCase()).toContain(".pdf");
});

test("D2: download resume DOCX", async () => {
  const d = await downloadFrom("Resume only", "DOCX");
  const dl = await d;
  expect(dl.suggestedFilename().toLowerCase()).toContain(".docx");
});

test("D3: download scorecard PDF", async () => {
  const d = await downloadFrom("Scorecard only", "PDF");
  const dl = await d;
  expect(dl.suggestedFilename().toLowerCase()).toContain(".pdf");
});

test("D4: download combined PDF", async () => {
  const d = await downloadFrom("Combined: Resume + Scorecard", "PDF");
  const dl = await d;
  expect(dl.suggestedFilename().toLowerCase()).toContain(".pdf");
});

test("D5: download combined DOCX", async () => {
  const d = await downloadFrom("Combined: Resume + Scorecard", "DOCX");
  const dl = await d;
  expect(dl.suggestedFilename().toLowerCase()).toContain(".docx");
});
