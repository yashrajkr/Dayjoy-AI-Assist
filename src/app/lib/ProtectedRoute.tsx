import React from "react";
import { Navigate } from "react-router-dom";
import { PermissionDenied } from "./PermissionDenied";
import { useAuth } from "./AuthContext";
import type { UserRole } from "./auth";
import { getSupabaseConfigError, isSupabaseConfigured } from "./supabaseClient";
import { AppShellFallback } from "../components/common/AppShellFallback";
import { BRAND } from "./brand";
import { DayjoyLogo } from "../components/brand/DayjoyLogo";

/**
 * Client-side route guard. Enforces that the user is signed in and (optionally)
 * holds one of `allowedRoles`. NOTE: this is a UX guard, NOT a security
 * boundary — backend RLS is the authoritative enforcement layer.
 */
export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactElement;
  allowedRoles?: UserRole[];
}) {
  const { loading, role } = useAuth();

  if (loading) {
    return <AppShellFallback />;
  }

  if (!role) {
    // Supabase not configured: show a branded setup message instead of
    // bouncing to /login (which would also fail).
    if (!isSupabaseConfigured()) {
      const message =
        getSupabaseConfigError() ??
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login.";

      return (
        <div
          className="min-h-screen flex items-center justify-center p-4"
          style={{ background: BRAND.colors.background }}
        >
          <div
            className="w-full max-w-xl rounded-3xl border p-8 shadow-xl text-center"
            style={{ background: BRAND.colors.card, borderColor: BRAND.colors.border }}
          >
            <div className="flex justify-center mb-4">
              <DayjoyLogo variant="mark" size={56} />
            </div>
            <h1
              className="text-xl font-semibold mb-2"
              style={{ color: BRAND.colors.foreground }}
            >
              {BRAND.name} needs setup
            </h1>
            <p className="text-sm mb-4" style={{ color: BRAND.colors.muted }}>
              {message}
            </p>
            <p className="text-sm mb-6" style={{ color: BRAND.colors.muted }}>
              You can still explore the UI once Supabase is connected.
            </p>
            <a
              className="inline-flex items-center justify-center rounded-xl px-4 py-2 font-medium hover:opacity-90"
              style={{ background: BRAND.colors.primary, color: BRAND.colors.primaryForeground }}
              href="/login"
            >
              Go to login
            </a>
          </div>
        </div>
      );
    }

    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(role)) {
      return <PermissionDenied />;
    }
  }

  return children;
}
