import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Load Supabase URL + anon key from backend/.env so helpers can mint a token
// for API-based test setup (creating jobs without the slow UI path). Never
// printed; only the URL host is non-secret.
try {
  const envPath = path.join(__dirname, "..", "backend", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k === "SUPABASE_URL" || k === "SUPABASE_ANON_KEY") process.env[k] = v;
  }
} catch {
  /* tests that don't need API setup still run */
}

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  // Real OpenAI scoring/crafting can take 30-60s; keep a generous per-test cap.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 1,
  // Hitting real production + OpenAI — running in parallel would multiply cost
  // and create cross-test data races on the shared account. Keep it serial.
  workers: 1,
  fullyParallel: false,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "https://recruitcraft.vercel.app",
    storageState: "./.auth/state.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
