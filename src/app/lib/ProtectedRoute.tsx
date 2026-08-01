import React from "react";
import { Navigate } from "react-router-dom";
import { PermissionDenied } from "./PermissionDenied";
import { useAuth } from "./AuthContext";
import type { UserRole } from "./auth";
import { isSupabaseConfigured } from "./supabaseClient";
import { AppShellFallback } from "../components/common/AppShellFallback";

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
    // If Supabase is not configured, redirect to the login page so the demo
    // fallback flow can still be used instead of blocking the app on setup.
    if (!isSupabaseConfigured()) {
      return <Navigate to="/login" replace />;
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
