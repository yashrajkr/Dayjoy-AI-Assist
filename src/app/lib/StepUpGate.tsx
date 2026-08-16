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
  // `state: { voluntary: true }` — this redirect happens whenever a user
  // navigates (sidebar link, direct URL, bookmark) to an elevated route
  // mid-session, which always means there's a real previous in-app page to
  // go back to. Without this, WorkspaceSwitcher's Back button (which only
  // treats a visit as "voluntary" when that flag is set — see its own
  // comment) wrongly assumed this was the mandatory post-login picker (no
  // real history) and signed the user out instead of navigating back. This
  // `<Navigate replace>` doesn't consume the history entry the user arrived
  // from, so `navigate(-1)` on Back correctly lands back where they were.
  return (
    <Navigate
      to={`/workspace?target=${view}&return=${encodeURIComponent(target)}`}
      state={{ voluntary: true }}
      replace
    />
  );
}
