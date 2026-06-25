/**
 * Browser Supabase client — used by the login page (app/login) to
 * authenticate recruiters via email + password. The resulting access token
 * is stored in localStorage("scorcraft_token") and attached as a Bearer
 * header on every backend call (see lib/api.ts getToken()).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Where api.ts looks for the bearer token. Keep these in sync. */
export const TOKEN_KEY = "scorcraft_token";

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Mirror the live session's access token into localStorage on sign-in and on
// every auto-refresh, and clear it on sign-out. This keeps the synchronous
// getToken() fallback (used by the route guard) from going stale — sending a
// stale, expired token was the cause of the production 401s.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    const token = session?.access_token;
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  });
}
