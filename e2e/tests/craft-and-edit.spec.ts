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

// Craft + edit share one crafted candidate. Serial: C1 crafts, the E-cases edit
// the open editor, E12 (mask) runs last with its own masked re-craft.
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  const token = await supabaseToken(request);
  const title = uniqueTitle("PW Craft");
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
  await expect(page.getByRole("button", { name: /Batch craft all/ })).toBeVisible();
});

test.afterAll(async () => {
  await page?.close();
});

test("C1: craft a single resume", async () => {
  test.setTimeout(120_000);
  await page.getByRole("button", { name: "Craft resume" }).click();
  await expect(page.getByText(/Crafted ✓/)).toBeVisible({ timeout: 90_000 });
});

test("C3: action buttons appear after crafting", async () => {
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scorecard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
});

test("E1: open the editor modal", async () => {
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText(/Edit resume:/)).toBeVisible();
  await expect(page.getByText("Live preview")).toBeVisible();
});

test("E2: edit name updates the preview", async () => {
  const nameInput = page.getByText("Name", { exact: true }).locator("xpath=following-sibling::input");
  await nameInput.fill("Modified Name");
  await expect(page.getByText("Modified Name").first()).toBeVisible();
});

test("E4: add a summary bullet", async () => {
  const before = await page.locator("textarea").count();
  await page.getByRole("button", { name: /Add bullet point/ }).click();
  expect(await page.locator("textarea").count()).toBe(before + 1);
});

test("E5: add a certification row", async () => {
  const before = await page.getByPlaceholder("Certification").count();
  await page.getByRole("button", { name: /Add certification/ }).click();
  expect(await page.getByPlaceholder("Certification").count()).toBe(before + 1);
});

test("E9: save changes closes the editor", async () => {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Edit resume:/)).toBeHidden({ timeout: 30_000 });
});

test("E12: PI masking hides contacts in the editor preview", async () => {
  test.setTimeout(120_000);
  // Go back to results, enable Mask PI, re-craft, then open the editor.
  await page.getByText("Review & filter").click();
  await expect(page.getByText("Cutoff:")).toBeVisible();
  await page.locator("label").filter({ hasText: "Mask PI" }).getByRole("button").click();
  await page.locator("label").filter({ hasText: /Select all/ }).getByRole("checkbox").check();
  await page.getByRole("button", { name: /Move to craft/ }).click();
  await page.getByRole("button", { name: "Craft resume" }).click();
  await expect(page.getByText(/Crafted ✓/)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Live preview")).toBeVisible();

  // Crafted content remains visible; an email address does not.
  await expect(page.getByText("Executive summary").first()).toBeVisible();
  expect(await page.getByText(/\b[\w.+-]+@[\w-]+\.\w+\b/).count()).toBe(0);
});
