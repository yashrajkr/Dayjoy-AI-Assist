import { supabase, isSupabaseConfigured } from "./supabaseClient";

export type UserRole =
  | "guest"
  | "customer"
  | "distributor"
  | "leader"
  | "trainer"
  | "employee"
  | "support"
  | "management"
  | "admin"
  | "super_admin";

/**
 * Returns the live Supabase client or throws if not configured.
 * All auth functions go through this so we get a single, loud failure
 * point instead of `supabase!` non-null assertions scattered everywhere.
 */
function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Missing Supabase URL / anon key.");
  }
  return supabase;
}

function mapSupabaseAuthErrorToMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");

  // Network/DNS / connectivity problems often surface as "Failed to fetch"
  if (message.toLowerCase().includes("failed to fetch")) {
    return "Cannot connect to Supabase. Check VITE_SUPABASE_URL, internet connection, and restart npm run dev.";
  }

  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials") || lower.includes("invalid_grant")) {
    return "Invalid login credentials.";
  }

  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return "Email not confirmed. Please check your inbox and confirm your email.";
  }

  if (lower.includes("missing supabase url")) return "Missing Supabase URL.";
  if (lower.includes("missing anon key")) return "Missing anon key.";

  // Fallback: return the original message (keeps it readable)
  return message || "Login failed.";
}

export async function signUpUser(params: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}) {
  if (!isSupabaseConfigured()) {
    // isSupabaseConfigured + supabaseClient now throws on import if missing,
    // but keep this for safety in case other bundling paths skip the throw.
    throw new Error("Missing Supabase URL / anon key.");
  }

  const { data, error } = await requireClient().auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
        role: params.role,
      },
    },
  });

  if (error) throw new Error(mapSupabaseAuthErrorToMessage(error));
  return data;
}

export async function signInUser(params: { email: string; password: string }) {
  if (!isSupabaseConfigured()) {
    throw new Error("Missing Supabase URL / anon key.");
  }

  const { data, error } = await requireClient().auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  if (error) throw new Error(mapSupabaseAuthErrorToMessage(error));
  return data;
}

export async function signOutUser() {
  if (!isSupabaseConfigured()) {
    throw new Error("Missing Supabase URL / anon key.");
  }

  const { error } = await requireClient().auth.signOut();
  if (error) throw new Error(mapSupabaseAuthErrorToMessage(error));
}

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await requireClient().auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    // Network errors (e.g. offline, CORS hiccup) should not crash the app.
    return null;
  }
}

export async function getCurrentSession() {
  if (!isSupabaseConfigured()) throw new Error("Missing Supabase URL / anon key.");
  try {
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw new Error(mapSupabaseAuthErrorToMessage(error));
    return data.session;
  } catch (e) {
    // Re-throw our mapped errors; swallow raw network errors.
    if (e instanceof Error && e.message.includes("Missing Supabase")) throw e;
    if (e instanceof Error && !e.message.includes("Failed to fetch")) throw e;
    return null;
  }
}

/**
 * Resolve the user's role. Prefers the value in `profiles.role` (which is
 * admin-managed and protected by RLS) over `user_metadata.role` (which is
 * user-writable on auth.users and only sanitized by the `handle_new_user()`
 * trigger at signup time).
 */
export async function getUserRoleFromProfile(userId: string): Promise<UserRole | null> {
  if (!isSupabaseConfigured() || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data?.role) return null;
    const allowed: UserRole[] = ["customer", "distributor", "leader", "trainer", "employee", "support", "management", "admin", "super_admin"];
    return allowed.includes(data.role as UserRole) ? (data.role as UserRole) : null;
  } catch {
    return null;
  }
}

export function getUserRoleFromMetadata(user: {
  user_metadata?: Record<string, unknown> | null;
} | null): UserRole | null {
  if (!user?.user_metadata) return null;

  const rawRole = user.user_metadata.role;
  if (typeof rawRole !== "string") return null;

  const allowed: UserRole[] = ["customer", "distributor", "leader", "trainer", "employee", "support", "management", "admin", "super_admin"];
  return allowed.includes(rawRole as UserRole) ? (rawRole as UserRole) : null;
}
