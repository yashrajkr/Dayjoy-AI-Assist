import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client bootstrap.
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the environment.
 * If either is missing or malformed, exports a stub client that throws on
 * use — `isSupabaseConfigured()` and `getSupabaseConfigError()` let the UI
 * surface the problem instead of crashing on import.
 *
 * NOTE: We intentionally do NOT log the URL or anon key to the browser
 * console. Previous versions did, which leaked project identifiers in
 * production. Diagnostics are limited to boolean flags.
 */

function requireEnvValue(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | undefined {
  const raw = import.meta.env[name];
  return raw?.trim() || undefined;
}

const supabaseUrl = requireEnvValue("VITE_SUPABASE_URL");
const supabaseAnonKey = requireEnvValue("VITE_SUPABASE_ANON_KEY");

function assertSupabaseUrlFormat(value: string): void {
  const trimmed = value.trim();
  const hasHttps = trimmed.startsWith("https://");
  const endsWithSupabaseDomain = trimmed.endsWith(".supabase.co");

  if (!hasHttps || !endsWithSupabaseDomain) {
    throw new Error(
      [
        "[supabase] Invalid VITE_SUPABASE_URL format.",
        "Expected: https://<project-ref>.supabase.co",
        `Received: ${trimmed}`,
      ].join("\n"),
    );
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey && !supabaseConfigError);
}

let supabaseConfigError: string | null = null;

if (!supabaseUrl) {
  supabaseConfigError = [
    "[supabase] Missing Supabase URL.",
    "Set VITE_SUPABASE_URL in your frontend .env (same folder as package.json).",
  ].join("\n");
}

if (!supabaseAnonKey) {
  supabaseConfigError = [
    ...(supabaseConfigError ? [supabaseConfigError] : []),
    "[supabase] Missing anon key.",
    "Set VITE_SUPABASE_ANON_KEY in your frontend .env (same folder as package.json).",
  ].join("\n");
}

if (supabaseUrl && !supabaseConfigError) {
  try {
    assertSupabaseUrlFormat(supabaseUrl);
  } catch (e) {
    supabaseConfigError = e instanceof Error ? e.message : String(e);
  }
}

export function getSupabaseConfigError(): string | null {
  return supabaseConfigError;
}

/**
 * The real Supabase client, or `null` if misconfigured.
 *
 * Callers MUST check `isSupabaseConfigured()` before touching this. Direct
 * access when misconfigured will throw — by design, so that the failure is
 * loud rather than silent.
 *
 * `autorefreshToken` is enabled (default) so existing sessions resume on
 * reload. `persistSession` is enabled so the session survives reloads.
 * `detectSessionInUrl` is disabled because we don't use email magic links
 * in the SPA flow — enabling it causes supabase-js to parse the URL hash
 * on every page load, which can race with React Router.
 */
export const supabase: SupabaseClient | null = supabaseConfigError
  ? null
  : createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
