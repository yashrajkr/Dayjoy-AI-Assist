import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, Phone, Mail, MapPin } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  StatusPill,
  EmptyState,
  LoadingState,
  ErrorState,
  StatCard,
  btnClass,
} from "../common/AdminUI";
import { Modal, modalButtonClass } from "../common/Modal";

type Lead = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  interested_category: string | null;
  lead_type: "customer" | "distributor" | null;
  preferred_language: string | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
};

const STATUSES = ["new", "contacted", "converted", "lost"];

export function LeadsCRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [editStatus, setEditStatus] = useState("new");
  const [editNotes, setEditNotes] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      let q = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(100);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (typeFilter) q = q.eq("lead_type", typeFilter);
      const { data, error: err } = await q;
      if (err) throw err;
      setLeads((data ?? []) as Lead[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openEdit = (l: Lead) => {
    setEditing(l);
    setEditStatus(l.status ?? "new");
    setEditNotes(l.notes ?? "");
  };

  const saveEdit = async () => {
    if (!editing || !supabase) return;
    try {
      const { error: err } = await supabase
        .from("leads")
        .update({ status: editStatus, notes: editNotes })
        .eq("id", editing.id);
      if (err) throw err;
      setLeads((prev) =>
        prev.map((l) =>
          l.id === editing.id ? { ...l, status: editStatus, notes: editNotes } : l,
        ),
      );
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update lead");
    }
  };

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status ?? "unknown"] = (acc[l.status ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Leads / CRM"
        description="Track and triage every lead captured from the public lead form."
        icon={<ClipboardList className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATUSES.map((s) => (
          <StatCard key={s} label={s} value={counts[s] ?? 0} />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label htmlFor="dj-lead-status" className="block text-xs font-medium text-muted-foreground mb-1">
            Status
          </label>
          <select
            id="dj-lead-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dj-lead-type" className="block text-xs font-medium text-muted-foreground mb-1">
            Type
          </label>
          <select
            id="dj-lead-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All types</option>
            <option value="customer">Customer</option>
            <option value="distributor">Distributor</option>
          </select>
        </div>
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading leads…" />
      ) : leads.length === 0 ? (
        <Card>
          <EmptyState
            title="No leads yet"
            description="When a customer submits the public lead form, they will appear here."
            icon={<ClipboardList className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {leads.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{l.full_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {l.lead_type ?? "—"} · {l.interested_category ?? "General"}
                  </p>
                </div>
                <StatusPill status={l.status ?? "new"} />
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {l.phone ? (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3 h-3" aria-hidden="true" /> {l.phone}
                  </div>
                ) : null}
                {l.email ? (
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="w-3 h-3" aria-hidden="true" /> {l.email}
                  </div>
                ) : null}
                {(l.city || l.region) ? (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" aria-hidden="true" /> {l.city}{l.city && l.region ? ", " : ""}{l.region}
                  </div>
                ) : null}
              </div>
              {l.notes ? (
                <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">{l.notes}</p>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}
                </span>
                <button type="button" className={btnClass.secondary} onClick={() => openEdit(l)}>
                  Update
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Update lead"
        description={editing?.full_name}
        size="md"
        footer={
          <>
            <button type="button" className={modalButtonClass.secondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className={modalButtonClass.primary} onClick={saveEdit}>
              Save
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="dj-lead-edit-status" className="block text-xs font-medium text-muted-foreground mb-1">
              Status
            </label>
            <select
              id="dj-lead-edit-status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dj-lead-edit-notes" className="block text-xs font-medium text-muted-foreground mb-1">
              Internal notes
            </label>
            <textarea
              id="dj-lead-edit-notes"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
