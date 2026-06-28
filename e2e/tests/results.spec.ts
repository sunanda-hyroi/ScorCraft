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

// Reaching the results view requires scoring, so score ONCE and share the page
// across the R-cases. Serial mode: order matters — the navigating case (R10)
// runs last.
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  const token = await supabaseToken(request);
  const title = uniqueTitle("PW Results");
  await apiCreateJob(request, token, { title, must: ["Python", "SQL", "Spark"], good: ["AWS", "Docker"] });

  const context = await browser.newContext({ storageState: ".auth/state.json" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await gotoDashboard(page);
  await selectJob(page, title);
  await uploadResumes(page, [RESUMES.rohan, RESUMES.amit]);
  await runScoringAndWait(page);
});

test.afterAll(async () => {
  await page?.close();
});

// Set a React-controlled range input's value (triggers onChange).
async function setRange(slider: ReturnType<Page["getByRole"]>, value: string) {
  await slider.evaluate((el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function row(name: string) {
  return page.locator("div").filter({ hasText: name }).filter({ hasText: "SCORE" }).last();
}

test("R1: summary bar shows totals", async () => {
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByText(/above cutoff/)).toBeVisible();
  await expect(page.getByText(/below cutoff/)).toBeVisible();
});

test("R2: cutoff slider updates", async () => {
  await setRange(page.getByRole("slider"), "80");
  await expect(page.getByText("80%")).toBeVisible();
});

test("R4: expand a candidate shows details", async () => {
  await page.getByText("Rohan Verma").click();
  await expect(page.getByText(/AI assessment/i).first()).toBeVisible();
  await expect(page.getByText(/Matched \(/).first()).toBeVisible();
});

test("R8: action items section is internal-only", async () => {
  await page.getByText("Amit Joshi").click();
  await expect(page.getByText(/Action items/i).first()).toBeVisible();
  await expect(page.getByText(/internal only/i).first()).toBeVisible();
});

test("R9: select all checks every candidate", async () => {
  await page.locator("label").filter({ hasText: /Select all/ }).getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /Move to craft/ })).toBeVisible();
  await expect(page.getByText(/\d+ selected/).first()).toBeVisible();
});

test("R11: PI masking hides email, keeps name", async () => {
  await page.locator("label").filter({ hasText: "Mask PI" }).getByRole("button").click();
  await expect(page.getByText(/•+@•+\.com/).first()).toBeVisible();
  await expect(page.getByText("Rohan Verma", { exact: true }).first()).toBeVisible();
  // Restore for later cases.
  await page.locator("label").filter({ hasText: "Mask PI" }).getByRole("button").click();
});

test("R12: scorecard-only download at review", async () => {
  // Expand a candidate and use its direct "Download scorecard" action.
  const rohan = row("Rohan Verma");
  await rohan.click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download scorecard/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename().toLowerCase()).toContain("scorecard");
  expect(download.suggestedFilename().toLowerCase()).toContain(".pdf");
});

test("R10: move selected to craft step", async () => {
  await page.locator("label").filter({ hasText: /Select all/ }).getByRole("checkbox").check();
  await page.getByRole("button", { name: /Move to craft/ }).click();
  await expect(page.getByRole("button", { name: /Batch craft all/ })).toBeVisible();
});
