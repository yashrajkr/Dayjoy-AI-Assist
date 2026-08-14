import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  getCurrentSession,
  getCurrentUser,
  getUserRoleFromMetadata,
  getUserRoleFromProfile,
  type UserRole,
  signOutUser,
} from "./auth";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

type AuthState = {
  currentUser: User | null;
  role: UserRole | null;
  loading: boolean;
  logout: () => Promise<void>;
  /** Re-reads the current session/demo-auth and updates currentUser/role.
   * Call this after a sign-in/sign-up write (Supabase or demo localStorage)
   * so a client-side `navigate()` sees the new identity immediately —
   * without it, only a full `window.location` reload would have picked up
   * the change, which is why login used to force one on every sign-in. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const DEMO_KEY = "dayjoy_demo_auth";

/**
 * Demo-mode identity, persisted to localStorage when Supabase is not
 * configured. Only customer / distributor / employee roles are allowed
 * here — never admin/management. Staff roles must come from Supabase.
 */
function readDemoAuth(): { id: string; role: UserRole } | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; role?: UserRole };
    if (!parsed?.id || !parsed?.role) return null;
    const staffRoles: UserRole[] = ["admin", "management", "super_admin"];
    if (staffRoles.includes(parsed.role)) {
      // Demote: never trust a staff role from localStorage.
      return { id: String(parsed.id), role: "customer" };
    }
    return { id: String(parsed.id), role: parsed.role };
  } catch {
    return null;
  }
}

/**
 * Builds a minimal Supabase-`User`-shaped object for demo mode so that
 * every feature keyed on `currentUser.id` (chat, voice sessions, recent
 * chats list, notifications, profile, settings, ...) works the same way
 * it would with a real session — chatStore.ts and friends already fall
 * back to in-memory/local storage when Supabase itself isn't configured,
 * so only `currentUser` being non-null was actually required here.
 */
function buildDemoUser(demo: { id: string; role: UserRole }): User {
  return {
    id: demo.id,
    email: `${demo.id}@demo.dayjoy.local`,
    app_metadata: {},
    user_metadata: { full_name: "Dayjoy User" },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try {
      if (isSupabaseConfigured()) {
        await signOutUser();
      }
    } catch (e) {
      console.warn("[auth] signOut failed", e);
    } finally {
      window.localStorage.removeItem(DEMO_KEY);
      setCurrentUser(null);
      setRole(null);
    }
  }, []);

  // Refresh can be triggered "silently" (no `loading` flip, no AppShellFallback
  // flash) for benign background re-auth events like Supabase's TOKEN_REFRESHED,
  // which fires whenever the tab regains focus/visibility.
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);

    if (!isSupabaseConfigured()) {
      const demo = readDemoAuth();
      if (demo) {
        setCurrentUser(buildDemoUser(demo));
        setRole(demo.role);
      } else {
        setCurrentUser(null);
        setRole(null);
      }
      if (!opts?.silent) setLoading(false);
      return;
    }

    try {
      await getCurrentSession().catch(() => undefined);

      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
        // Prefer the role stored in `profiles` (RLS-protected, admin-managed)
        // over user_metadata (writable by the user, sanitized only at signup).
        let resolvedRole: UserRole | null = null;
        if (user?.id) {
          resolvedRole = await getUserRoleFromProfile(user.id);
        }
        if (!resolvedRole) {
          resolvedRole = getUserRoleFromMetadata(user);
        }
        setRole(resolvedRole);
      } catch (e) {
        console.error("[auth] Failed to fetch current user; continuing without auth.", e);
        setCurrentUser(null);
        setRole(null);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let hasRunInitialRefresh = false;

    refresh().then(() => {
      hasRunInitialRefresh = true;
    });

    if (isSupabaseConfigured() && supabase) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        // TOKEN_REFRESHED/INITIAL_SESSION fire on benign background events
        // (e.g. the tab regaining focus) — refresh state without flipping
        // `loading`, so returning to the tab doesn't flash the full-page
        // loading fallback. Real sign-in/out transitions still show it.
        const isBenignEvent = event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION";
        refresh({ silent: isBenignEvent && hasRunInitialRefresh });
      });
      unsub = () => data.subscription.unsubscribe();
    }

    return () => {
      if (unsub) unsub();
    };
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ currentUser, role, loading, logout, refresh: () => refresh() }),
    [currentUser, role, loading, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
