import { useCallback, useEffect, useState } from "react";
import {
  Settings as SettingsIcon, Save, ToggleLeft, ToggleRight, Building2, Palette,
  KeyRound, Plus, Trash2, Copy, Check, Loader2, Bell, Languages, Shield, Database,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { BRAND } from "../../lib/brand";
import {
  PageHeader, Card, LoadingState, ErrorState, EmptyState, btnClass,
} from "../common/AdminUI";
import {
  adminGetOrgSettings, adminUpdateOrgSettings, adminListAPIKeys, adminCreateAPIKey,
  adminRevokeAPIKey, adminListNotificationTemplates, adminBroadcastNotification,
  type OrgSettings, type AdminAPIKey,
} from "../../../lib/api";

type FeatureFlag = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rollout_percentage: number | null;
  allowed_roles: string[] | null;
  updated_at: string | null;
};

type Tab = "general" | "branding" | "feature_flags" | "api_keys" | "notifications" | "security";

export function AdminSettings() {
  const [tab, setTab] = useState<Tab>("general");
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [apiKeys, setApiKeys] = useState<AdminAPIKey[]>([]);
  const [templates, setTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Org settings
      try {
        const os = await adminGetOrgSettings();
        setOrgSettings(os);
      } catch { /* ignore */ }

      // API keys
      try {
        const keys = await adminListAPIKeys();
        setApiKeys(keys);
      } catch { /* ignore */ }

      // Notification templates
      try {
        const tpls = await adminListNotificationTemplates();
        setTemplates(tpls);
      } catch { /* ignore */ }

      // Feature flags (direct Supabase)
      if (supabase) {
        const { data, error: err } = await supabase
          .from("feature_flags")
          .select("*")
          .order("key", { ascending: true });
        if (!err && data) setFlags(data as FeatureFlag[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleFlag = async (f: FeatureFlag) => {
    if (!supabase) return;
    setSavingKey(f.key);
    try {
      const next = !f.enabled;
      await supabase.from("feature_flags").update({ enabled: next }).eq("id", f.id);
      setFlags((prev) => prev.map((x) => x.id === f.id ? { ...x, enabled: next } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update flag");
    } finally {
      setSavingKey(null);
    }
  };

  const saveOrg = async () => {
    if (!orgSettings) return;
    setSavingOrg(true);
    setError(null);
    try {
      await adminUpdateOrgSettings(orgSettings);
      setSuccess("Organization settings saved.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingOrg(false);
    }
  };

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    setError(null);
    try {
      const res = await adminCreateAPIKey({ name: newKeyName, scopes: ["read", "write"] });
      setNewKeyValue(res.key);
      setApiKeys((prev) => [...prev, res.record].filter(Boolean) as AdminAPIKey[]);
      setNewKeyName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeKey = async (id: string) => {
    if (!window.confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      await adminRevokeAPIKey(id);
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return;
    setBroadcasting(true);
    setError(null);
    try {
      await adminBroadcastNotification({
        title: broadcastTitle,
        body: broadcastBody,
        category: "announcement",
        channels: ["in_app"],
      });
      setBroadcastTitle("");
      setBroadcastBody("");
      setSuccess("Announcement broadcast to all users.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setBroadcasting(false);
    }
  };

  const tabs: { value: Tab; label: string; icon: typeof Building2 }[] = [
    { value: "general", label: "Organization", icon: Building2 },
    { value: "branding", label: "Branding", icon: Palette },
    { value: "feature_flags", label: "Feature Flags", icon: ToggleLeft },
    { value: "api_keys", label: "API Keys", icon: KeyRound },
    { value: "notifications", label: "Notifications", icon: Bell },
    { value: "security", label: "Security", icon: Shield },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Admin Settings"
        description={`Manage organization, branding, API keys, notifications, and security for ${BRAND.name}.`}
        icon={<SettingsIcon className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}
      {success ? (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">{success}</div>
      ) : null}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t.value
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState label="Loading…" /> : null}

      {/* General / Organization */}
      {tab === "general" && orgSettings ? (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Organization Details</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Company Name</label>
                <input type="text" value={orgSettings.company_name ?? ""}
                  onChange={(e) => setOrgSettings({ ...orgSettings, company_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Support Email</label>
                <input type="email" value={orgSettings.support_email ?? ""}
                  onChange={(e) => setOrgSettings({ ...orgSettings, support_email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Support Phone</label>
                <input type="tel" value={orgSettings.support_phone ?? ""}
                  onChange={(e) => setOrgSettings({ ...orgSettings, support_phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Default Language</label>
                <select value={orgSettings.default_language ?? "en"}
                  onChange={(e) => setOrgSettings({ ...orgSettings, default_language: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                  <option value="kn">Kannada</option>
                  <option value="mr">Marathi</option>
                  <option value="bn">Bengali</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Enabled Languages (comma-separated)</label>
                <input type="text" value={(orgSettings.enabled_languages ?? ["en"]).join(", ")}
                  onChange={(e) => setOrgSettings({ ...orgSettings, enabled_languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Storage Quota (MB)</label>
                <input type="number" value={orgSettings.storage_quota_mb ?? 1024}
                  onChange={(e) => setOrgSettings({ ...orgSettings, storage_quota_mb: parseInt(e.target.value) || 1024 })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <button type="button" className={`${btnClass.primary} mt-4`} onClick={saveOrg} disabled={savingOrg}>
              {savingOrg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </Card>
        </div>
      ) : null}

      {/* Branding */}
      {tab === "branding" && orgSettings ? (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Palette className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Branding</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Logo URL</label>
              <input type="text" value={orgSettings.logo_url ?? ""}
                onChange={(e) => setOrgSettings({ ...orgSettings, logo_url: e.target.value })}
                placeholder="https://…/logo.png"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={orgSettings.primary_color ?? "#0f766e"}
                    onChange={(e) => setOrgSettings({ ...orgSettings, primary_color: e.target.value })}
                    className="w-10 h-10 rounded border border-border" />
                  <input type="text" value={orgSettings.primary_color ?? "#0f766e"}
                    onChange={(e) => setOrgSettings({ ...orgSettings, primary_color: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Accent Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={orgSettings.accent_color ?? "#f59e0b"}
                    onChange={(e) => setOrgSettings({ ...orgSettings, accent_color: e.target.value })}
                    className="w-10 h-10 rounded border border-border" />
                  <input type="text" value={orgSettings.accent_color ?? "#f59e0b"}
                    onChange={(e) => setOrgSettings({ ...orgSettings, accent_color: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono" />
                </div>
              </div>
            </div>
            <button type="button" className={btnClass.primary} onClick={saveOrg} disabled={savingOrg}>
              {savingOrg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save branding
            </button>
          </div>
        </Card>
      ) : null}

      {/* Feature Flags */}
      {tab === "feature_flags" ? (
        <div className="space-y-2">
          {flags.length === 0 ? (
            <Card><EmptyState title="No feature flags" description="Run supabase_schema_v2.sql to seed default flags." icon={<ToggleLeft className="w-5 h-5" />} /></Card>
          ) : (
            flags.map((f) => (
              <Card key={f.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <code className="text-sm font-mono font-medium">{f.key}</code>
                  {f.description ? <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p> : null}
                </div>
                <button type="button" onClick={() => toggleFlag(f)} disabled={savingKey === f.key} className={btnClass.secondary} aria-pressed={f.enabled}>
                  {f.enabled ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                  {f.enabled ? "Enabled" : "Disabled"}
                </button>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {/* API Keys */}
      {tab === "api_keys" ? (
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Generate New API Key
            </h2>
            <div className="flex gap-2">
              <input type="text" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. Mobile App, Zapier)"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <button type="button" className={btnClass.primary} onClick={createKey} disabled={creatingKey || !newKeyName.trim()}>
                {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Generate
              </button>
            </div>
            {newKeyValue ? (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-medium text-warning mb-1">⚠ Copy this key now — it won't be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono break-all bg-card px-2 py-1 rounded">{newKeyValue}</code>
                  <button type="button" onClick={() => {
                    navigator.clipboard.writeText(newKeyValue);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }} className="p-1.5 rounded hover:bg-accent" aria-label="Copy key">
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button type="button" className={`${btnClass.secondary} mt-2 text-xs`} onClick={() => setNewKeyValue(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Active API Keys ({apiKeys.length})</h2>
            </div>
            {apiKeys.length === 0 ? (
              <div className="p-4"><EmptyState title="No API keys" description="Generate a key above to enable external API access." icon={<KeyRound className="w-5 h-5" />} /></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Prefix</th>
                    <th className="px-4 py-2 font-medium hidden sm:table-cell">Scopes</th>
                    <th className="px-4 py-2 font-medium hidden sm:table-cell">Created</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                      <td className="px-4 py-2 font-medium">{k.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{k.key_prefix}…</td>
                      <td className="px-4 py-2 hidden sm:table-cell text-xs text-muted-foreground">{k.scopes.join(", ")}</td>
                      <td className="px-4 py-2 hidden sm:table-cell text-xs text-muted-foreground">{new Date(k.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" onClick={() => revokeKey(k.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive" title="Revoke" aria-label="Revoke">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}

      {/* Notifications */}
      {tab === "notifications" ? (
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> Broadcast Announcement
            </h2>
            <div className="space-y-3">
              <input type="text" value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="Announcement title"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <textarea value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Announcement body…"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <button type="button" className={btnClass.primary} onClick={sendBroadcast} disabled={broadcasting || !broadcastTitle.trim() || !broadcastBody.trim()}>
                {broadcasting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Send to all users
              </button>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Notification Templates ({templates.length})</h2>
            </div>
            {templates.length === 0 ? (
              <div className="p-4"><EmptyState title="No templates" description="Run supabase_schema_v7_admin.sql to seed templates." icon={<Bell className="w-5 h-5" />} /></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Key</th>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium hidden sm:table-cell">Category</th>
                    <th className="px-4 py-2 font-medium hidden sm:table-cell">Channels</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={String(t.id)} className="border-b border-border last:border-0 hover:bg-accent/30">
                      <td className="px-4 py-2 font-mono text-xs">{String(t.template_key)}</td>
                      <td className="px-4 py-2 font-medium">{String(t.title)}</td>
                      <td className="px-4 py-2 hidden sm:table-cell text-xs text-muted-foreground">{String(t.category)}</td>
                      <td className="px-4 py-2 hidden sm:table-cell text-xs text-muted-foreground">{Array.isArray(t.channels) ? (t.channels as string[]).join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}

      {/* Security */}
      {tab === "security" && orgSettings ? (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Security Settings</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Password Minimum Length</label>
              <input type="number" value={orgSettings.password_min_length ?? 8}
                onChange={(e) => setOrgSettings({ ...orgSettings, password_min_length: parseInt(e.target.value) || 8 })}
                min={6} max={64}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Session Timeout (minutes)</label>
              <input type="number" value={orgSettings.session_timeout_minutes ?? 60}
                onChange={(e) => setOrgSettings({ ...orgSettings, session_timeout_minutes: parseInt(e.target.value) || 60 })}
                min={5} max={1440}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          </div>
          <button type="button" className={`${btnClass.primary} mt-4`} onClick={saveOrg} disabled={savingOrg}>
            {savingOrg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </Card>
      ) : null}
    </div>
  );
}
