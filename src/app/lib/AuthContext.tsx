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
    const staffRoles: UserRole[] = ["admin", "management"];
    if (staffRoles.includes(parsed.role)) {
      // Demote: never trust a staff role from localStorage.
      return { id: String(parsed.id), role: "customer" };
    }
    return { id: String(parsed.id), role: parsed.role };
  } catch {
    return null;
  }
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

  const refresh = useCallback(async () => {
    setLoading(true);

    if (!isSupabaseConfigured()) {
      const demo = readDemoAuth();
      if (demo) {
        setCurrentUser(null);
        setRole(demo.role);
      } else {
        setCurrentUser(null);
        setRole(null);
      }
      setLoading(false);
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    refresh();

    if (isSupabaseConfigured() && supabase) {
      const { data } = supabase.auth.onAuthStateChange(() => {
        refresh();
      });
      unsub = () => data.subscription.unsubscribe();
    }

    return () => {
      if (unsub) unsub();
    };
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ currentUser, role, loading, logout }),
    [currentUser, role, loading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
