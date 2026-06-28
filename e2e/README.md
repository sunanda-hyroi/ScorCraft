# RecruitCraft E2E (Playwright)

Browser end-to-end tests for **https://recruitcraft.vercel.app** (real production +
real OpenAI). They exercise auth, job management, upload/scoring, results review,
crafting/editing, downloads, and craft settings.

## Setup

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
```

A shared test account is used: `playwright@hyroi.com` / `PlayTest1234!`.
To (re)create it (idempotent — "already exists" is fine):

```bash
# from repo root — reads SUPABASE_URL + SUPABASE_ANON_KEY from backend/.env
python3 - <<'PY'
import json, urllib.request, urllib.error
env={}
for l in open('backend/.env'):
    if '=' in l and not l.startswith('#'):
        k,v=l.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
u=env['SUPABASE_URL'].rstrip('/'); a=env['SUPABASE_ANON_KEY']
b=json.dumps({"email":"playwright@hyroi.com","password":"PlayTest1234!","data":{"full_name":"Playwright Bot"}}).encode()
r=urllib.request.Request(u+"/auth/v1/signup",data=b,method="POST",headers={"apikey":a,"Content-Type":"application/json"})
try: print("created", urllib.request.urlopen(r,timeout=30).status)
except urllib.error.HTTPError as e: print("exists/ok", e.code)
PY
```

`backend/.env` must contain `SUPABASE_URL` and `SUPABASE_ANON_KEY` — `playwright.config.ts`
loads them so the helpers can mint a token for fast API-based job setup.

## Run

```bash
npm test                 # full suite, HTML + list reporters
npm run report           # open the last HTML report
npx playwright test auth.spec.ts            # one file
npx playwright test -g "D1"                 # one case
```

> Use `npx playwright` (or `./node_modules/.bin/playwright`), not a global install,
> to avoid a version mismatch with the local `@playwright/test`.

## How it works

- **`global-setup.ts`** logs in once via the UI and saves the session to
  `.auth/state.json`; every spec reuses it via `storageState` (no re-login).
  `.auth/` is git-ignored — it holds a real access token.
- **Auth/signup** tests run with a cleared session (`test.use({ storageState: … })`).
- The scoring/crafting specs (`results`, `craft-and-edit`, `downloads`,
  `craft-settings`) score **once** in `beforeAll` and share a single page in
  `test.describe.serial` mode to keep OpenAI cost down. Jobs are seeded through
  the backend API (fast, no AI); scoring/crafting go through the UI.
- Locators are resilient (`getByRole`/`getByText`/`getByPlaceholder`); no CSS
  classes / ids / test-ids.
- Fixtures in `fixtures/` are generated resume PDFs spanning strong → no-match.

## Cost / notes

- Tests hit **real production** and **real OpenAI** — each full run costs a few
  cents and takes several minutes.
- Job titles are timestamped, so reruns don't collide. Test jobs are left in the
  workspace (archived/active) rather than hard-deleted, so parallel runs are safe.
- `screenshot: only-on-failure` + `trace: retain-on-failure` are on; artifacts
  land in `test-results/`.

## Cases covered

auth A1–A10 · jobs J1,J4–J8,J10 · upload/score U1,U2,U5,S2–S5 ·
results R1,R2,R4,R8–R12 · craft/edit C1,C3,E1,E2,E4,E5,E9,E12 ·
downloads D1–D6 · craft settings CS1,CS2,CS4,CS5
