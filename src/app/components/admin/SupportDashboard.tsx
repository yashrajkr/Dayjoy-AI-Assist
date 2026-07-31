import { useCallback, useEffect, useState } from "react";
import { Headphones, Ticket, Clock, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader,
  Card,
  StatCard,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusPill,
} from "../common/AdminUI";

type Ticket = {
  id: string;
  query: string | null;
  status: string | null;
  priority: string | null;
  created_at: string | null;
};

/**
 * Support Dashboard — for support team members.
 *
 * Shows: assigned tickets, open tickets, resolved today, recent ticket list.
 */
export function SupportDashboard() {
  const { currentUser } = useAuth();
  const [stats, setStats] = useState({ assigned: 0, open: 0, resolved: 0 });
  const [recent, setRecent] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const [assigned, open, resolved, recentData] = await Promise.all([
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("assigned_to", currentUser?.id ?? ""),
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).neq("status", "closed"),
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("status", "resolved"),
        supabase.from("support_tickets").select("id,query,status,priority,created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      setStats({
        assigned: assigned.count ?? 0,
        open: open.count ?? 0,
        resolved: resolved.count ?? 0,
      });
      setRecent((recentData.data ?? []) as Ticket[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Support Dashboard"
        description="Triage tickets, respond to customers, and resolve issues."
        icon={<Headphones className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Assigned to me" value={stats.assigned} icon={<Ticket className="w-5 h-5" />} />
            <StatCard label="Open tickets" value={stats.open} icon={<Clock className="w-5 h-5" />} />
            <StatCard label="Resolved" value={stats.resolved} icon={<CheckCircle2 className="w-5 h-5" />} />
          </div>

          <Card>
            <h2 className="text-sm font-semibold mb-3">Recent tickets</h2>
            {recent.length === 0 ? (
              <EmptyState
                title="No tickets yet"
                description="When customers raise tickets, they will appear here."
                icon={<Headphones className="w-5 h-5" />}
              />
            ) : (
              <ul className="space-y-2">
                {recent.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 p-2 rounded-lg hover:bg-accent/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium line-clamp-2">{t.query || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.created_at ? new Date(t.created_at).toLocaleString() : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.priority ? <StatusPill status={t.priority} /> : null}
                      {t.status ? <StatusPill status={t.status} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
