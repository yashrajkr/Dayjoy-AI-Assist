import type { UserRole } from "./auth";

/**
 * A "workspace" is a distinct experience the same logged-in account can
 * switch between — separate from `role`, which only determines which
 * workspaces an account is *entitled* to open.
 */
export type WorkspaceView = "customer" | "distributor" | "leader";

export const WORKSPACE_VIEWS: Record<
  WorkspaceView,
  { label: string; portalName: string; description: string; path: string; requiresStepUp: boolean }
> = {
  customer: {
    label: "Customer Experience",
    portalName: "Customer Portal",
    description: "AI chat, product discovery, orders & support — the everyday Dayjoy assistant.",
    path: "/",
    requiresStepUp: false,
  },
  distributor: {
    label: "Distributor Business Hub",
    portalName: "Distributor Portal",
    description: "Your sales dashboard, team, targets, AI business coach & reports.",
    path: "/distributor/dashboard",
    requiresStepUp: true,
  },
  leader: {
    label: "Leader Dashboard",
    portalName: "Leader Portal",
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

const LAST_WORKSPACE_KEY = "dayjoy_last_workspace";

/**
 * Remembers which workspace a multi-view account last opened, so a
 * returning login can skip straight to it instead of always re-showing
 * the picker. Purely a UX shortcut — it never grants access on its own:
 * the target route still runs through ProtectedRoute (role check) and
 * StepUpGate (password re-confirmation) exactly as if the user had
 * clicked the card themselves.
 */
export function getLastWorkspace(): WorkspaceView | null {
  try {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    return raw === "customer" || raw === "distributor" || raw === "leader" ? raw : null;
  } catch {
    return null;
  }
}

export function setLastWorkspace(view: WorkspaceView): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, view);
  } catch {
    // localStorage unavailable — next login just falls back to the picker.
  }
}
