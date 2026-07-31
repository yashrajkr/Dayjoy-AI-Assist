import { useCallback, useEffect, useState } from "react";
import { Briefcase, ClipboardList, Headphones, MessageSquare } from "lucide-react";
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

export function EmployeeDashboard() {
  const { currentUser } = useAuth();
  const [stats, setStats] = useState({ assignedTickets: 0, openTickets: 0, recentChats: 0 });
  const [recentTickets, setRecentTickets] = useState<Array<{ id: string; query: string | null; status: string | null; priority: string | null; created_at: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase || !currentUser?.id) {
      setLoading(false);
      return;
    }
    try {
      const [assigned, open, chats] = await Promise.all([
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("assigned_to", currentUser.id),
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("assigned_to", currentUser.id).neq("status", "closed"),
        supabase.from("chat_conversations").select("*", { count: "exact", head: true }).eq("user_id", currentUser.id).limit(50),
      ]);
      setStats({
        assignedTickets: assigned.count ?? 0,
        openTickets: open.count ?? 0,
        recentChats: chats.count ?? 0,
      });

      const { data: tickets } = await supabase
        .from("support_tickets")
        .select("id, query, status, priority, created_at")
        .eq("assigned_to", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentTickets((tickets ?? []) as typeof recentTickets);
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
        title="Employee Dashboard"
        description="Your assigned work and recent activity."
        icon={<Briefcase className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Assigned tickets" value={stats.assignedTickets} icon={<Headphones className="w-5 h-5" />} />
            <StatCard label="Open tickets" value={stats.openTickets} icon={<ClipboardList className="w-5 h-5" />} />
            <StatCard label="Your chats" value={stats.recentChats} icon={<MessageSquare className="w-5 h-5" />} />
          </div>

          <Card>
            <h2 className="text-sm font-semibold mb-3">Recent assigned tickets</h2>
            {recentTickets.length === 0 ? (
              <EmptyState
                title="No tickets assigned to you"
                description="Pick up a ticket from the Support Tickets page to see it here."
                icon={<Headphones className="w-5 h-5" />}
              />
            ) : (
              <ul className="space-y-2">
                {recentTickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-2 p-2 rounded-lg hover:bg-accent/30"
                  >
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
