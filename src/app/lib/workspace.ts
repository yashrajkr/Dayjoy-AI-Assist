import type { UserRole } from "./auth";

/**
 * A "workspace" is a distinct experience the same logged-in account can
 * switch between — separate from `role`, which only determines which
 * workspaces an account is *entitled* to open.
 */
export type WorkspaceView = "customer" | "distributor" | "leader";

export const WORKSPACE_VIEWS: Record<
  WorkspaceView,
  { label: string; description: string; path: string; requiresStepUp: boolean }
> = {
  customer: {
    label: "Customer Experience",
    description: "AI chat, product discovery, orders & support — the everyday Dayjoy assistant.",
    path: "/",
    requiresStepUp: false,
  },
  distributor: {
    label: "Distributor Business Hub",
    description: "Your sales dashboard, team, targets, AI business coach & reports.",
    path: "/distributor/dashboard",
    requiresStepUp: true,
  },
  leader: {
    label: "Leader Dashboard",
    description: "Team-wide performance, rank progress & downline management.",
    path: "/admin/leader",
    requiresStepUp: true,
  },
};

/** Which workspaces each account role is entitled to switch between. */
const ROLE_VIEWS: Record<UserRole, WorkspaceView[]> = {
  guest: [],
  customer: ["customer"],
  distributor: ["customer", "distributor"],
  leader: ["customer", "distributor", "leader"],
  trainer: ["customer", "distributor"],
  employee: ["customer", "distributor"],
  support: ["customer", "distributor"],
  management: ["customer", "distributor", "leader"],
  admin: ["customer", "distributor", "leader"],
  super_admin: ["customer", "distributor", "leader"],
};

export function getAvailableViews(role: UserRole | null): WorkspaceView[] {
  if (!role) return [];
  return ROLE_VIEWS[role] ?? ["customer"];
}

export function hasMultipleViews(role: UserRole | null): boolean {
  return getAvailableViews(role).length > 1;
}

const STEP_UP_PREFIX = "dayjoy_stepup_";

/**
 * Step-up verification is session-scoped on purpose: it should survive
 * in-app navigation but not a closed tab/browser, so re-entering the
 * Business Hub or Leader Dashboard on a new session always re-confirms
 * the account's password.
 */
export function isStepUpVerified(view: WorkspaceView): boolean {
  try {
    return window.sessionStorage.getItem(STEP_UP_PREFIX + view) === "1";
  } catch {
    return false;
  }
}

export function markStepUpVerified(view: WorkspaceView): void {
  try {
    window.sessionStorage.setItem(STEP_UP_PREFIX + view, "1");
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — re-auth will just be asked again next time.
  }
}
