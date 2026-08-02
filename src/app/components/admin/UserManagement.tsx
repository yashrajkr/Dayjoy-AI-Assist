import { useCallback, useEffect, useState } from "react";
import {
  Users, Search, ShieldCheck, UserCog, Download, KeyRound, Ban, RefreshCw,
  Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import {
  PageHeader, Card, StatusPill, EmptyState, LoadingState, ErrorState,
} from "../common/AdminUI";
import { Modal } from "../common/Modal";
import type { UserRole } from "../../lib/auth";
import {
  adminListUsers, adminUpdateUser, adminResetUserPassword, adminExportUsers,
  type AdminUser,
} from "../../../lib/api";
import { Button } from "../ui/button";

const ROLES: UserRole[] = ["customer", "distributor", "employee", "trainer", "leader", "support", "management", "admin", "super_admin"];

type Profile = AdminUser & {
  email?: string | null;
  is_suspended?: boolean | null;
  last_seen_at?: string | null;
};

export function UserManagement() {
  const { role: myRole, currentUser } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | UserRole>("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("customer");
  const [editName, setEditName] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editRegion, setEditRegion] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const limit = 50;
  const canManage = myRole === "admin" || myRole === "super_admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await adminListUsers({
        limit,
        offset,
        search: search || undefined,
        role: roleFilter || undefined,
      });
      setProfiles(data.users as Profile[]);
      setTotal(data.total);
    } catch {
      // Fallback to direct Supabase
      if (!supabase) {
        setError("Supabase is not configured. Cannot load users.");
        setLoading(false);
        return;
      }
      try {
        let q = supabase.from("profiles").select("*").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
        if (roleFilter) q = q.eq("role", roleFilter);
        if (search) q = q.ilike("full_name", `%${search}%`);
        const { data: rows, error: err } = await q;
        if (err) throw err;
        setProfiles((rows ?? []) as Profile[]);
        setTotal(rows?.length ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load users");
      }
    } finally {
      setLoading(false);
    }
  }, [offset, roleFilter, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openEdit = (p: Profile) => {
    setEditing(p);
    setEditRole(p.role as UserRole);
    setEditName(p.full_name ?? "");
    setEditLanguage(p.language ?? "");
    setEditRegion(p.region ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await adminUpdateUser(editing.id, {
        role: editRole,
        full_name: editName || undefined,
        language: editLanguage || undefined,
        region: editRegion || undefined,
      });
      setProfiles((prev) =>
        prev.map((p) => p.id === editing.id ? {
          ...p, role: editRole, full_name: editName,
          language: editLanguage, region: editRegion,
        } : p),
      );
      setEditing(null);
      setSuccess("User updated successfully.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      // Fallback
      if (supabase) {
        try {
          const payload: Record<string, unknown> = { role: editRole };
          if (editName) payload.full_name = editName;
          if (editLanguage) payload.language = editLanguage;
          if (editRegion) payload.region = editRegion;
          await supabase.from("profiles").update(payload).eq("id", editing.id);
          setProfiles((prev) => prev.map((p) => p.id === editing.id ? { ...p, ...payload } as Profile : p));
          setEditing(null);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : "Failed to update");
        }
      } else {
        setError(e instanceof Error ? e.message : "Failed to update");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSuspend = async (p: Profile) => {
    if (!window.confirm(`${p.is_suspended ? "Unsuspend" : "Suspend"} ${p.full_name || p.id.slice(0, 8)}?`)) return;
    try {
      await adminUpdateUser(p.id, { is_suspended: !p.is_suspended });
      setProfiles((prev) => prev.map((u) => u.id === p.id ? { ...u, is_suspended: !p.is_suspended } : u));
      setSuccess(`${p.is_suspended ? "Unsuspended" : "Suspended"} ${p.full_name || "user"}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to suspend user");
    }
  };

  const handleResetPassword = async (p: Profile) => {
    if (!window.confirm(`Send a password reset email to ${p.full_name || p.id.slice(0, 8)}?`)) return;
    setSaving(true);
    try {
      await adminResetUserPassword(p.id);
      setSuccess("Password reset email sent.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reset email");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const { csv, count } = await adminExportUsers(roleFilter || undefined);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dayjoy-users-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(`Exported ${count} users.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const roleCounts = profiles.reduce<Record<string, number>>((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="User Management"
        description="Create, edit, suspend, and manage user roles. All changes are audit-logged."
        icon={<Users className="w-5 h-5" />}
        actions={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export CSV
            </Button>
          ) : null
        }
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}
      {success ? (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {success}
        </div>
      ) : null}

      {/* Role counts */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">
        {ROLES.map((r) => (
          <Card key={r} className="text-center p-3">
            <p className="text-xl font-semibold">{roleCounts[r] ?? 0}</p>
            <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{r.replace("_", " ")}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="flex-1 relative">
          <label htmlFor="dj-user-search" className="sr-only">Search users</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <input
            id="dj-user-search"
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value as "" | UserRole); setOffset(0); }}
          className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r} className="capitalize">{r.replace("_", " ")}</option>
          ))}
        </select>
        <Button type="button" variant="secondary" onClick={refresh}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading users…" />
      ) : profiles.length === 0 ? (
        <Card>
          <EmptyState title="No users found" description="Try adjusting your search or filter." icon={<UserCog className="w-5 h-5" />} />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Language</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Region</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Joined</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className={`border-b border-border last:border-0 hover:bg-accent/30 ${p.is_suspended ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium flex items-center gap-2">
                        {p.full_name || "—"}
                        {p.is_suspended ? <Ban className="w-3 h-3 text-destructive" /> : null}
                        {p.id === currentUser?.id ? <span className="text-[10px] text-muted-foreground">(you)</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{p.id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={p.role.replace("_", " ")} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.language || "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{p.region || "—"}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {canManage ? (
                          <>
                            <button type="button" className="p-1.5 rounded-lg hover:bg-accent/60" title="Edit role" aria-label="Edit" onClick={() => openEdit(p)}>
                              <UserCog className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="p-1.5 rounded-lg hover:bg-accent/60" title="Reset password" aria-label="Reset password" onClick={() => handleResetPassword(p)}>
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="p-1.5 rounded-lg hover:bg-warning/10 text-warning" title={p.is_suspended ? "Unsuspend" : "Suspend"} aria-label="Suspend" onClick={() => handleSuspend(p)}>
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">View only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > limit ? (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <Button type="button" variant="secondary" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit user"
        description={editing ? `${editing.full_name || "Unnamed"} · ${editing.id.slice(0, 8)}…` : undefined}
        size="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="button" onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="dj-edit-name" className="block text-xs font-medium text-muted-foreground mb-1">Full name</label>
            <input id="dj-edit-name" type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label htmlFor="dj-edit-role" className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
            <select id="dj-edit-role" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
              {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dj-edit-lang" className="block text-xs font-medium text-muted-foreground mb-1">Language</label>
              <input id="dj-edit-lang" type="text" value={editLanguage} onChange={(e) => setEditLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div>
              <label htmlFor="dj-edit-region" className="block text-xs font-medium text-muted-foreground mb-1">Region</label>
              <input id="dj-edit-region" type="text" value={editRegion} onChange={(e) => setEditRegion(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Only {BRAND.name} admins can change roles. All changes are recorded in the audit log.
          </p>
        </div>
      </Modal>
    </div>
  );
}
