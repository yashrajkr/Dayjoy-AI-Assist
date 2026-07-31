import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Shield, Lock, Save, Loader2, Check, X, Filter, RotateCcw,
} from "lucide-react";
import {
  PageHeader, Card, LoadingState, ErrorState, btnClass,
} from "../common/AdminUI";
import {
  adminGetRolePermissions, adminUpdateRolePermissions,
  type RolePermission,
} from "../../../lib/api";

const ROLES = [
  { value: "customer", label: "Customer", color: "bg-muted text-muted-foreground" },
  { value: "distributor", label: "Distributor", color: "bg-blue-100 text-blue-700" },
  { value: "employee", label: "Employee", color: "bg-purple-100 text-purple-700" },
  { value: "trainer", label: "Trainer", color: "bg-orange-100 text-orange-700" },
  { value: "leader", label: "Leader", color: "bg-indigo-100 text-indigo-700" },
  { value: "support", label: "Support", color: "bg-cyan-100 text-cyan-700" },
  { value: "management", label: "Management", color: "bg-emerald-100 text-emerald-700" },
  { value: "admin", label: "Admin", color: "bg-rose-100 text-rose-700" },
  { value: "super_admin", label: "Super Admin", color: "bg-amber-100 text-amber-700" },
];

const PAGES = [
  { value: "admin/dashboard", label: "Dashboard", group: "Overview" },
  { value: "admin/analytics", label: "Analytics", group: "Overview" },
  { value: "admin/search", label: "Universal Search", group: "Overview" },
  { value: "admin/knowledge", label: "Knowledge Base", group: "Knowledge" },
  { value: "admin/products", label: "Products", group: "Knowledge" },
  { value: "admin/faqs", label: "FAQs", group: "Knowledge" },
  { value: "admin/policies", label: "Policies", group: "Knowledge" },
  { value: "admin/training", label: "Training", group: "Knowledge" },
  { value: "admin/approvals", label: "Approval Queue", group: "Knowledge" },
  { value: "admin/safety", label: "Safety Rules", group: "Knowledge" },
  { value: "admin/ai-config", label: "AI Config", group: "System" },
  { value: "admin/leads", label: "Leads / CRM", group: "Operations" },
  { value: "admin/users", label: "Users", group: "Operations" },
  { value: "admin/support", label: "Support Tickets", group: "Operations" },
  { value: "admin/audit", label: "Audit Logs", group: "System" },
  { value: "admin/integrations", label: "Integrations", group: "System" },
  { value: "admin/settings", label: "Settings", group: "System" },
  { value: "admin/roles", label: "Role Permissions", group: "System" },
  { value: "admin/notifications", label: "Notifications", group: "System" },
];

const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "manage", "assign"];

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
  manage: "Manage",
  assign: "Assign",
};

export function RolePermissions() {
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [original, setOriginal] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminGetRolePermissions();
      setPermissions(data);
      setOriginal(data);
    } catch {
      // Fallback: build empty matrix
      const empty: RolePermission[] = [];
      for (const role of ROLES) {
        for (const page of PAGES) {
          for (const action of ACTIONS) {
            empty.push({ role: role.value, page: page.value, action, allowed: false });
          }
        }
      }
      setPermissions(empty);
      setOriginal(empty);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasChange = useMemo(() => {
    if (permissions.length !== original.length) return true;
    return permissions.some((p, i) => {
      const o = original[i];
      return !o || p.allowed !== o.allowed;
    });
  }, [permissions, original]);

  const toggle = (role: string, page: string, action: string, allowed: boolean) => {
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.role === role && p.page === page && p.action === action);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], allowed };
        return copy;
      }
      return [...prev, { role, page, action, allowed }];
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changed = permissions.filter((p, i) => {
        const o = original[i];
        return !o || p.allowed !== o.allowed;
      });
      if (changed.length === 0) {
        setSaved(true);
        return;
      }
      await adminUpdateRolePermissions(changed);
      setOriginal(permissions);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const filteredPages = groupFilter ? PAGES.filter((p) => p.group === groupFilter) : PAGES;
  const groupedPages = filteredPages.reduce<Record<string, typeof PAGES>>((acc, p) => {
    (acc[p.group] = acc[p.group] || []).push(p);
    return acc;
  }, {});

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader title="Role & Permissions" icon={<Shield className="w-5 h-5" />} />
      <LoadingState label="Loading permission matrix…" />
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Role & Permissions"
        description="Configure which roles can access which pages and perform which actions. Changes are audit-logged."
        icon={<Shield className="w-5 h-5" />}
        actions={
          <>
            <button type="button" className={btnClass.secondary} onClick={load} disabled={!hasChange && !saved}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset
            </button>
            <button
              type="button"
              className={btnClass.primary}
              onClick={save}
              disabled={saving || !hasChange}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
              {saved ? "Saved!" : "Save changes"}
            </button>
          </>
        }
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {/* Filter */}
      <Card className="mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filter by group:
          </span>
          <button
            type="button"
            onClick={() => setGroupFilter("")}
            className={`text-xs px-2 py-1 rounded-full ${groupFilter === "" ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}
          >
            All
          </button>
          {["Overview", "Knowledge", "Operations", "System"].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupFilter(g)}
              className={`text-xs px-2 py-1 rounded-full ${groupFilter === g ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}
            >
              {g}
            </button>
          ))}
          {hasChange ? (
            <span className="ml-auto text-xs text-warning flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" /> Unsaved changes
            </span>
          ) : null}
        </div>
      </Card>

      {/* Legend */}
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <span key={r.value} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${r.color}`}>
              {r.label}
            </span>
          ))}
        </div>
      </Card>

      {/* Matrix — grouped by page group */}
      <div className="space-y-6">
        {Object.entries(groupedPages).map(([group, pages]) => (
          <div key={group}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">{group}</h2>
            <Card className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 font-medium sticky left-0 bg-card z-10">Page / Action</th>
                    {ROLES.map((r) => (
                      <th key={r.value} className="px-2 py-2 font-medium text-center min-w-[60px]">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${r.color.split(" ")[0]}`} />
                          <span className="text-[10px]">{r.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    ACTIONS.map((action, ai) => (
                      <tr key={`${page.value}-${action}`} className="border-b border-border last:border-0 hover:bg-accent/20">
                        <td className="px-3 py-1.5 sticky left-0 bg-card z-10">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{page.label}</span>
                            {ai === 0 ? null : <span className="text-[10px] text-muted-foreground">· {ACTION_LABELS[action]}</span>}
                          </div>
                          {ai === 0 ? (
                            <span className="text-[10px] text-muted-foreground font-mono">{page.value}</span>
                          ) : null}
                        </td>
                        {ROLES.map((r) => {
                          const perm = permissions.find(
                            (p) => p.role === r.value && p.page === page.value && p.action === action,
                          );
                          const allowed = perm?.allowed ?? false;
                          return (
                            <td key={r.value} className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => toggle(r.value, page.value, action, !allowed)}
                                className={`w-6 h-6 rounded inline-flex items-center justify-center transition-colors ${
                                  allowed
                                    ? "bg-primary text-primary-foreground hover:opacity-80"
                                    : "bg-accent text-muted-foreground hover:bg-accent/80"
                                }`}
                                aria-label={`${allowed ? "Revoke" : "Grant"} ${r.label} ${ACTION_LABELS[action]} on ${page.label}`}
                                title={`${r.label} → ${page.label} → ${ACTION_LABELS[action]}: ${allowed ? "allowed" : "denied"}`}
                              >
                                {allowed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-40" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))}
      </div>

      {/* Security note */}
      <Card className="mt-6 border-warning/30 bg-warning/5">
        <div className="flex items-start gap-2">
          <Lock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-warning">Security note</p>
            <p className="text-muted-foreground mt-0.5">
              This UI shows the permission matrix for convenience, but the actual
              enforcement happens in two places: (1) Supabase Row-Level Security
              policies on each table, and (2) the FastAPI backend's role check
              in each <code>/admin/*</code> endpoint. Changes here update the
              <code> role_permissions</code> table which the backend reads at
              authorization time.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
