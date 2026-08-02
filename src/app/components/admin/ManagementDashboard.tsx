import { useCallback, useEffect, useState } from "react";
import { Building2, Users, Headphones, ClipboardList, BarChart3 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  StatCard,
  LoadingState,
  ErrorState,
} from "../common/AdminUI";
import { Button } from "../ui/button";

export function ManagementDashboard() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalLeads: 0,
    openTickets: 0,
    totalChats: 0,
    pendingApprovals: 0,
  });
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
      const [users, leads, tickets, chats, products] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("leads").select("*", { count: "exact", head: true }),
        supabase.from("support_tickets").select("*", { count: "exact", head: true }).neq("status", "closed"),
        supabase.from("chat_conversations").select("*", { count: "exact", head: true }),
        supabase.from("products").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
      ]);
      setStats({
        totalUsers: users.count ?? 0,
        totalLeads: leads.count ?? 0,
        openTickets: tickets.count ?? 0,
        totalChats: chats.count ?? 0,
        pendingApprovals: products.count ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Management Dashboard"
        description="Executive overview of platform health and growth."
        icon={<Building2 className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <StatCard label="Total users" value={stats.totalUsers} icon={<Users className="w-5 h-5" />} />
            <StatCard label="Total leads" value={stats.totalLeads} icon={<ClipboardList className="w-5 h-5" />} />
            <StatCard label="Open tickets" value={stats.openTickets} icon={<Headphones className="w-5 h-5" />} />
            <StatCard label="Chat conversations" value={stats.totalChats} icon={<BarChart3 className="w-5 h-5" />} />
            <StatCard label="Pending approvals" value={stats.pendingApprovals} hint={stats.pendingApprovals > 0 ? "Action needed" : "All clear"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <h2 className="text-sm font-semibold mb-2">What to look at</h2>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>Pending product approvals — clear them so users see fresh content.</li>
                <li>Open support tickets — assign overdue ones to staff.</li>
                <li>Lead conversion rate — check the Leads CRM for follow-ups.</li>
                <li>Chat volume — compare week-over-week via Analytics.</li>
              </ul>
            </Card>
            <Card>
              <h2 className="text-sm font-semibold mb-2">Quick actions</h2>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href="/admin/approvals">Approve content</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href="/admin/support">Triage tickets</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href="/admin/leads">Review leads</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href="/admin/analytics">View analytics</a>
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
