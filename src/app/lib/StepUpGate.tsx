import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isStepUpVerified, WORKSPACE_VIEWS, type WorkspaceView } from "./workspace";

/**
 * Guards an elevated workspace route (Business Hub, Leader Dashboard) so
 * that reaching it directly by URL — not just via the WorkspaceSwitcher
 * cards — still enforces the Dayjoy ID + password re-confirmation for this
 * browser session.
 */
export function StepUpGate({ view, children }: { view: WorkspaceView; children: ReactElement }) {
  const location = useLocation();

  if (!WORKSPACE_VIEWS[view].requiresStepUp || isStepUpVerified(view)) {
    return children;
  }

  const target = `${location.pathname}${location.search}`;
  return <Navigate to={`/workspace?target=${view}&return=${encodeURIComponent(target)}`} replace />;
}
