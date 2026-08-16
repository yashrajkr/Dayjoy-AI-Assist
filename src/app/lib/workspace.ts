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
 * Step-up verification is remembered per account (keyed by user id), not
 * per browser session. Once an account has confirmed its Dayjoy ID +
 * password for a given workspace, re-opening that workspace on a later
 * login (same email, same device) skips straight in — no re-typing the
 * password every single time. It's still gated on `userId` so a different
 * account signing in on a shared device always gets its own fresh check,
 * and the underlying route is still protected by `StepUpGate` + the normal
 * role check — this only ever short-circuits a *re-prompt*, never access
 * itself.
 */
export function isStepUpVerified(view: WorkspaceView, userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(STEP_UP_PREFIX + userId + "_" + view) === "1";
  } catch {
    return false;
  }
}

export function markStepUpVerified(view: WorkspaceView, userId: string | null | undefined): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(STEP_UP_PREFIX + userId + "_" + view, "1");
  } catch {
    // localStorage unavailable (e.g. private browsing) — re-auth will just be asked again next time.
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
