import { NavLink } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { UserRole } from "./auth";

const ROLE_LABELS: Record<string, string> = {
  guest: "Guest",
  customer: "Customer",
  distributor: "Distributor",
  leader: "Leader",
  trainer: "Trainer",
  employee: "Employee",
  support: "Support",
  management: "Management",
  admin: "Admin",
  super_admin: "Super Admin",
};

function label(r: string): string {
  return ROLE_LABELS[r] ?? r;
}

/**
 * Shown when a signed-in user opens a route their role can't access.
 *
 * Names both the role the account actually has and the roles the page
 * requires. The previous version only said "your current role doesn't have
 * access", which made a role-provisioning problem (an account still sitting
 * at `customer` because signup/Google OAuth defaulted it there) look
 * identical to a broken, missing, or failed-to-deploy page — the Business
 * Hub "isn't showing after redeploying" reports were exactly this.
 */
export function PermissionDenied({ requiredRoles }: { requiredRoles?: readonly UserRole[] }) {
  const { role } = useAuth();

  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center p-4 sm:p-6 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-semibold mb-2 text-primary">Permission denied</h1>
        <p className="text-sm text-muted-foreground mb-4">
          This page isn’t available for your account’s role. Nothing is broken —
          your account just needs a different role to open it.
        </p>

        <dl className="space-y-2 mb-5 text-sm">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-accent/30 px-3 py-2">
            <dt className="text-muted-foreground shrink-0">Your role</dt>
            <dd className="font-medium text-right">{role ? label(role) : "Not signed in"}</dd>
          </div>
          {requiredRoles && requiredRoles.length > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-accent/30 px-3 py-2">
              <dt className="text-muted-foreground shrink-0">Page requires</dt>
              <dd className="font-medium text-right">
                {[...new Set(requiredRoles.map(label))].join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="text-xs text-muted-foreground mb-4">
          Ask a Dayjoy admin to update your role in User Management, then sign
          out and back in to pick up the change.
        </p>

        <NavLink
          to="/"
          className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
        >
          Go to Home
        </NavLink>
      </div>
    </div>
  );
}
