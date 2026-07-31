import { useEffect, useMemo, useState } from "react";
import {
  addLead,
  getLeads,
  logAnalytics,
  type Lead,
  type LeadInsert,
  type AnalyticsEvent,
} from "../../lib/db";
import { getCurrentUser } from "../../lib/auth";

type LeadType = "customer" | "distributor";

function isValidEmail(value: string): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizePhone(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function LeadCapturePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const user = await getCurrentUser();
      if (!cancelled) {
        setUserId(user?.id ?? null);
        setLoadingUser(false);
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, []);

  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);

  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLeads() {
      setLeadsLoading(true);
      setLeadsError(null);

      try {
        const rows = await getLeads();
        if (!cancelled) setLeads(rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load leads";
        if (!cancelled) setLeadsError(message);
      } finally {
        if (!cancelled) setLeadsLoading(false);
      }
    }

    loadLeads();

    return () => {
      cancelled = true;
    };
  }, []);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    region: "",
    interested_category: "",
    lead_type: "customer" as LeadType,
    preferred_language: "English",
    notes: "",
  });

  const phoneValid = useMemo(() => {
    const p = normalizePhone(form.phone);
    if (!p) return true;
    return /^[+]?[\d]{8,15}$/.test(p);
  }, [form.phone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMessage(null);
    setSubmitError(null);

    try {
      const payload: LeadInsert = {
        full_name: form.full_name.trim(),
        phone: normalizePhone(form.phone) || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        region: form.region.trim() || null,
        interested_category: form.interested_category.trim() || null,
        lead_type: form.lead_type,
        preferred_language: form.preferred_language.trim() || null,
        notes: form.notes.trim() || null,
        created_by: userId,
      };

      if (!payload.full_name) throw new Error("Full name is required.");
      if (!payload.phone && !payload.email) {
        throw new Error("Please provide at least a phone or an email.");
      }
      if (!phoneValid) throw new Error("Phone number looks invalid.");
      if (!isValidEmail(payload.email ?? "")) throw new Error("Email looks invalid.");

      await addLead(payload);
      setSubmitMessage("Lead saved successfully. Our team will follow up soon.");

      // Log analytics event (best-effort; db.ts falls back safely)
      try {
        const event: AnalyticsEvent = {
          user_id: userId,
          role: form.lead_type,
          language: safeString(payload.preferred_language) ?? null,
          query: null,
          category: safeString(payload.interested_category) ?? null,
          source_used: "lead_capture_form",
          safety_status: "safe",
        };
        await logAnalytics(event);
      } catch {
        // Never block UX on analytics.
      }

      // Optimistic UI refresh
      const rows = await getLeads().catch(() => null);
      if (rows) setLeads(rows);

      setForm({
        full_name: "",
        phone: "",
        email: "",
        city: "",
        state: "",
        region: "",
        interested_category: "",
        lead_type: "customer",
        preferred_language: "English",
        notes: "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save lead";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-sm text-muted-foreground mb-2">Dayjoy AI / Leads</p>
          <h1 className="text-3xl font-semibold mb-2">Lead Capture</h1>
          <p className="text-muted-foreground">
            Save customer or distributor leads so your team can follow up.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {submitMessage ? (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
              {submitMessage}
            </div>
          ) : null}

          {submitError ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {submitError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                placeholder="Full name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
              <select
                value={form.lead_type}
                onChange={(e) =>
                  setForm({ ...form, lead_type: e.target.value as LeadType })
                }
                className="border rounded-xl p-3 w-full bg-background"
              >
                <option value="customer">Customer</option>
                <option value="distributor">Distributor</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
              <input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
              <input
                placeholder="State"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
              <input
                placeholder="Region"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="border rounded-xl p-3 w-full bg-background"
              />
            </div>

            <input
              placeholder="Interested category"
              value={form.interested_category}
              onChange={(e) =>
                setForm({ ...form, interested_category: e.target.value })
              }
              className="border rounded-xl p-3 w-full bg-background"
            />

            <select
              value={form.preferred_language}
              onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}
              className="border rounded-xl p-3 w-full bg-background"
              disabled={loadingUser}
            >
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Hinglish">Hinglish</option>
            </select>

            <textarea
              placeholder="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="border rounded-xl p-3 w-full min-h-28 bg-background"
            />

            <button
              type="submit"
              disabled={submitting}
              className="bg-primary text-primary-foreground rounded-xl px-5 py-3 w-full font-medium disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save Lead"}
            </button>
          </form>

          <p className="text-xs text-muted-foreground mt-4">
            {userId ? (
              <>
                Saving will include your user id (<span className="font-medium">{userId}</span>) for RLS.
              </>
            ) : (
              <>
                You’re not logged in. If your Supabase RLS requires <code>created_by</code>, login first.
              </>
            )}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Leads</h2>
            <p className="text-xs text-muted-foreground">
              {leadsLoading ? "Loading..." : `${leads.length} total`}
            </p>
          </div>

          {leadsError ? (
            <div className="text-sm text-red-600 bg-background border border-border rounded-xl p-3">
              {leadsError}
            </div>
          ) : leadsLoading ? (
            <div className="text-sm text-muted-foreground py-6">Loading leads…</div>
          ) : leads.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">No leads found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="py-3 pr-3">Name</th>
                    <th className="py-3 pr-3">Phone</th>
                    <th className="py-3 pr-3">Email</th>
                    <th className="py-3 pr-3">Category</th>
                    <th className="py-3 pr-3">Type</th>
                    <th className="py-3 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 50).map((l) => (
                    <tr key={String(l.id ?? l.full_name)} className="border-b border-border">
                      <td className="py-3 pr-3 font-medium">{l.full_name}</td>
                      <td className="py-3 pr-3">{l.phone ?? "-"}</td>
                      <td className="py-3 pr-3">{l.email ?? "-"}</td>
                      <td className="py-3 pr-3">{l.interested_category ?? "-"}</td>
                      <td className="py-3 pr-3">{l.lead_type ?? "-"}</td>
                      <td className="py-3 pr-3">{l.status ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
