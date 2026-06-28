import { test, expect } from "@playwright/test";

const VALID_EMAIL = "playwright@hyroi.com";
const VALID_PASSWORD = "PlayTest1234!";

// ── Logged-out flows: run with a clean session so login/signup behave as a
//    fresh visitor. ─────────────────────────────────────────────────────────
test.describe("auth — logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("A1: signup happy path", async ({ page }) => {
    await page.goto("/signup");
    const email = `playwright-signup-${Date.now()}@hyroi.com`;
    await page.getByPlaceholder("Jane Recruiter").fill("Test User");
    await page.getByPlaceholder("you@hyroi.com").fill(email);
    await page.getByPlaceholder("At least 8 characters").fill("Test1234!");
    await page.getByPlaceholder("••••••••").fill("Test1234!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/Account created successfully/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/, { timeout: 6000 });
  });

  test("A2: signup password mismatch", async ({ page }) => {
    await page.goto("/signup");
    await page.getByPlaceholder("Jane Recruiter").fill("Test User");
    await page.getByPlaceholder("you@hyroi.com").fill(`mismatch-${Date.now()}@hyroi.com`);
    await page.getByPlaceholder("At least 8 characters").fill("Test1234!");
    await page.getByPlaceholder("••••••••").fill("Different1!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/Passwords do not match/i)).toBeVisible();
  });

  test("A3: signup weak password", async ({ page }) => {
    await page.goto("/signup");
    await page.getByPlaceholder("Jane Recruiter").fill("Test User");
    await page.getByPlaceholder("you@hyroi.com").fill(`weak-${Date.now()}@hyroi.com`);
    await page.getByPlaceholder("At least 8 characters").fill("123");
    await page.getByPlaceholder("••••••••").fill("123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test("A5: login happy path", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@hyroi.com").fill(VALID_EMAIL);
    await page.getByPlaceholder("••••••••").fill(VALID_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  });

  test("A6: login wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@hyroi.com").fill(VALID_EMAIL);
    await page.getByPlaceholder("••••••••").fill("WrongPassword999!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 30_000 });
  });

  test("A7: login empty fields → validation blocks submit", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
    const emailInvalid = await page
      .getByPlaceholder("you@hyroi.com")
      .evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(emailInvalid).toBeTruthy();
  });

  test("A8: password eye toggle", async ({ page }) => {
    await page.goto("/login");
    const pw = page.getByPlaceholder("••••••••");
    await pw.fill("somepassword");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(pw).toHaveAttribute("type", "password");
  });

  test("A10: auth guard redirects unauthenticated to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});

// NOTE: the logout case (A9) lives in zz-logout.spec.ts so it runs LAST.
// supabase.auth.signOut() revokes the user's session globally, which would
// poison the shared storageState for every spec that runs after it.
