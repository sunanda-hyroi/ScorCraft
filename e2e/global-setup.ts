import { chromium } from "@playwright/test";

// Logs in ONCE through the real UI and saves the authenticated session
// (cookies + localStorage, including the Supabase session and the
// scorcraft_token the app reads) to .auth/state.json. All specs reuse it via
// `storageState` so no test logs in again.
export const TEST_EMAIL = "playwright@hyroi.com";
export const TEST_PASSWORD = "PlayTest1234!";
const BASE = "https://recruitcraft.vercel.app";

async function attemptLogin(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@hyroi.com").fill(TEST_EMAIL);
  await page.getByPlaceholder("••••••••").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Dashboard is reached when the header "Sign out" button is present.
  await page
    .getByRole("button", { name: "Sign out" })
    .waitFor({ state: "visible", timeout: 90_000 });
}

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // Production (Vercel + Railway) can cold-start on the first hit; retry once.
    try {
      await attemptLogin(page);
    } catch {
      // eslint-disable-next-line no-console
      console.log("[global-setup] first login attempt failed — retrying after warm-up");
      await attemptLogin(page);
    }
    // Give the Supabase client a beat to persist its session to localStorage.
    await page.waitForTimeout(1500);
    await page.context().storageState({ path: ".auth/state.json" });
    // eslint-disable-next-line no-console
    console.log("[global-setup] logged in and saved auth state");
  } finally {
    await browser.close();
  }
}

export default globalSetup;
