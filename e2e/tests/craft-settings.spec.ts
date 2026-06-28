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

// The Craft Settings panel lives in the results controls, so a scored job is
// required. Score once, share the page across the CS-cases.
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  const token = await supabaseToken(request);
  const title = uniqueTitle("PW Settings");
  await apiCreateJob(request, token, { title, must: ["Python", "SQL", "Spark"], good: ["AWS", "Docker"] });

  const context = await browser.newContext({ storageState: ".auth/state.json" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await gotoDashboard(page);
  await selectJob(page, title);
  await uploadResumes(page, [RESUMES.rohan]);
  await runScoringAndWait(page);
});

test.afterAll(async () => {
  await page?.close();
});

const OFF_COLOR = "rgb(209, 213, 219)"; // #D1D5DB — toggle "off" track

function toggleButton(label: string) {
  return page.locator("label").filter({ hasText: label }).getByRole("button");
}

test("CS1: open the craft settings panel", async () => {
  await page.getByRole("button", { name: /Craft settings/ }).click();
  await expect(page.getByText("Company name")).toBeVisible();
});

test("CS2: set the company name", async () => {
  const input = page.getByText("Company name", { exact: true }).locator("xpath=following-sibling::input");
  await input.fill("Test Corp");
  await expect(input).toHaveValue("Test Corp");
});

test("CS4: toggle Include header off", async () => {
  const btn = toggleButton("Include header");
  await btn.click();
  await expect(btn).toHaveCSS("background-color", OFF_COLOR);
});

test("CS5: toggle Include footer off", async () => {
  const btn = toggleButton("Include footer");
  await btn.click();
  await expect(btn).toHaveCSS("background-color", OFF_COLOR);
});
