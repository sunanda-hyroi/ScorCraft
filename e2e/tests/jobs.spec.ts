import { test, expect, Page } from "@playwright/test";
import { apiCreateJob, gotoDashboard, selectJob, supabaseToken, uniqueTitle } from "./helpers";

// Read-only + mutating job specs. Each mutating test gets its own freshly
// created job (via the fast API path) so they don't interfere with each other.
let jobRead = "";
let jobDup = "";
let jobArch = "";

test.beforeAll(async ({ request }) => {
  const token = await supabaseToken(request);
  jobRead = uniqueTitle("PW Read");
  jobDup = uniqueTitle("PW Dup");
  jobArch = uniqueTitle("PW Arch");
  for (const title of [jobRead, jobDup, jobArch]) {
    await apiCreateJob(request, token, { title, must: ["Python", "SQL", "Spark"], good: ["AWS", "Docker"] });
  }
});

// Locate a job card (the container with the title + its kebab "Job actions").
function jobCard(page: Page, title: string) {
  return page
    .locator("div")
    .filter({ hasText: title })
    .filter({ has: page.getByRole("button", { name: "Job actions" }) })
    .last();
}

async function openKebab(page: Page, title: string) {
  await jobCard(page, title).getByRole("button", { name: "Job actions" }).click();
}

test("J1: create job via UI", async ({ page }) => {
  await gotoDashboard(page);
  const title = uniqueTitle("PW Create");
  await page.getByRole("button", { name: /Create (new|your first) job/ }).click();
  await page.getByPlaceholder("e.g. Senior Power BI Developer").fill(title);

  const skillInput = page.getByPlaceholder(/Type a skill and press Enter/);
  for (const s of ["Python", "SQL", "Spark", "AWS", "Docker"]) {
    await skillInput.fill(s);
    await skillInput.press("Enter");
    await expect(page.getByText(s, { exact: true }).first()).toBeVisible();
  }
  // Dismiss the auto-opened alias suggestion panel for the last skill.
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();

  // Mark AWS + Docker as Good to Have.
  for (const s of ["AWS", "Docker"]) {
    const row = page
      .locator("div")
      .filter({ hasText: s })
      .filter({ has: page.getByRole("button", { name: "Must Have" }) })
      .last();
    await row.getByRole("button", { name: "Good to Have" }).click();
  }

  await page.getByRole("button", { name: /Save Job/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("J2: manual skill alias — add, persists, reopens", async ({ page }) => {
  await gotoDashboard(page);
  const title = uniqueTitle("PW Alias");
  await page.getByRole("button", { name: /Create (new|your first) job/ }).click();
  await page.getByPlaceholder("e.g. Senior Power BI Developer").fill(title);

  const skillInput = page.getByPlaceholder(/Type a skill and press Enter/);
  await skillInput.fill("Operating System");
  await skillInput.press("Enter");
  await expect(page.getByText("Operating System", { exact: true }).first()).toBeVisible();

  // The "+ alias" button is reachable even with the AI suggestion panel open.
  await page.getByTitle(/Add a custom alias/).click();
  const aliasInput = page.getByPlaceholder("Type alias, Enter to add");
  await aliasInput.fill("OS");
  await aliasInput.press("Enter");
  // Chip appears immediately with a "manual" tag.
  await expect(page.getByText("manual", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Save Job/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });

  // Reopen via Duplicate (edit-as-new-version) — the manual alias must still be there.
  const card = page
    .locator("div")
    .filter({ hasText: title })
    .filter({ has: page.getByRole("button", { name: "Job actions" }) })
    .last();
  await card.getByRole("button", { name: "Job actions" }).click();
  await page.getByRole("button", { name: "📑 Duplicate" }).click();
  await expect(page.getByPlaceholder("e.g. Senior Power BI Developer")).toHaveValue(`${title} v2`, {
    timeout: 15_000,
  });
  await expect(page.getByText("manual", { exact: true }).first()).toBeVisible();
});

test("J4: job list displays card details", async ({ page }) => {
  await gotoDashboard(page);
  const card = jobCard(page, jobRead);
  await expect(card.getByText(jobRead, { exact: true })).toBeVisible();
  await expect(card.getByText(/\d+ skill/)).toBeVisible();
  await expect(card.getByText("Active", { exact: true })).toBeVisible();
});

test("J5: search filters the job list", async ({ page }) => {
  await gotoDashboard(page);
  await page.getByPlaceholder(/Search by title or company/).fill(jobRead);
  await expect(page.getByText(jobRead, { exact: true })).toBeVisible();
  await expect(page.getByText(jobDup, { exact: true })).toBeHidden();
});

test("J6: filter by status tab", async ({ page }) => {
  await gotoDashboard(page);
  await page.getByRole("button", { name: /^Active \(/ }).click();
  await expect(page.getByText(jobRead, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Archived \(/ }).click();
  await expect(page.getByText(jobRead, { exact: true })).toBeHidden();
});

test("J7: duplicate job creates next version", async ({ page }) => {
  await gotoDashboard(page);
  await openKebab(page, jobDup);
  await page.getByRole("button", { name: "📑 Duplicate" }).click();
  // Duplicate form pre-fills the title with a " v2" suffix.
  await expect(page.getByPlaceholder("e.g. Senior Power BI Developer")).toHaveValue(`${jobDup} v2`, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /Save Job/ }).click();
  await expect(page.getByText(`${jobDup} v2`, { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("J8: archive job moves it to archived", async ({ page }) => {
  await gotoDashboard(page);
  await openKebab(page, jobArch);
  await page.getByRole("button", { name: "🗄️ Archive" }).click();
  // After refresh it should no longer be under Active, but present under Archived.
  await page.getByRole("button", { name: /^Active \(/ }).click();
  await expect(page.getByText(jobArch, { exact: true })).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Archived \(/ }).click();
  await expect(page.getByText(jobArch, { exact: true })).toBeVisible();
});

test("J10: select job advances to upload", async ({ page }) => {
  await gotoDashboard(page);
  await selectJob(page, jobRead);
  await expect(page.getByText(/Drop resumes here or click to browse/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Score 0 resume|Score \d+ resume/ })).toBeVisible();
});
