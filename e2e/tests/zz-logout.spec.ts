import { test, expect } from "@playwright/test";

// A9 — logout. Deliberately the LAST spec to run (file name sorts last):
// supabase.auth.signOut() revokes the user's session globally, so running it
// earlier would invalidate the shared storageState (state.json) and drop every
// later spec into an unauthenticated state. global-setup re-logs-in at the start
// of the next run, so revoking here at the very end is harmless.
test("A9: logout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
