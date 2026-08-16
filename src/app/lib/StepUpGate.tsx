import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { isStepUpVerified, WORKSPACE_VIEWS, type WorkspaceView } from "./workspace";

/**
 * Guards an elevated workspace route (Business Hub, Leader Dashboard) so
 * that reaching it directly by URL — not just via the WorkspaceSwitcher
 * cards — still enforces the Dayjoy ID + password re-confirmation, unless
 * this account has already confirmed it before (see `isStepUpVerified`).
 */
export function StepUpGate({ view, children }: { view: WorkspaceView; children: ReactElement }) {
  const location = useLocation();
  const { currentUser } = useAuth();

  if (!WORKSPACE_VIEWS[view].requiresStepUp || isStepUpVerified(view, currentUser?.id)) {
    return children;
  }

  const target = `${location.pathname}${location.search}`;
  return <Navigate to={`/workspace?target=${view}&return=${encodeURIComponent(target)}`} replace />;
}
