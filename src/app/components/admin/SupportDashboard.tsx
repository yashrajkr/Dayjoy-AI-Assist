import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Headphones, Ticket, Clock, CheckCircle2, AlertTriangle, Sparkles,
  MessageSquare, Search, BarChart3, BookOpen,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState, StatusPill, Button,
} from "../common/AdminUI";
import { LineChart, ProgressBar, type LineChartPoint } from "../common/Charts";
import { analyticsSupport, analyticsListAlerts, analyticsKnowledge, type AnalyticsAlert } from "../../../lib/api";

type SupportTicket = {
  id: string;
  query: string | null;
  status: string | null;
  priority: string | null;
  created_at: string | null;
};

export function SupportDashboard() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [stats, setStats] = useState({ assigned: 0, open: 0, resolved: 0 });
  const [recent, setRecent] = useState<SupportTicket[]>([]);
  const [trend, setTrend] = useState<LineChartPoint[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, number | null> | null>(null);
  const [alerts, setAlerts] = useState<AnalyticsAlert[]>([]);
  const [knowledge, setKnowledge] = useState<{ total: number; fresh: number; aging: number; stale: number; coverage_pct: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let assignedCount = 0;
      let openCount = 0;
      let resolvedCount = 0;
      let recentTickets: SupportTicket[] = [];

      if (supabase) {
        const [assigned, open, resolved, recentData] = await Promise.all([
          supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("assigned_to", currentUser?.id ?? ""),
          supabase.from("support_tickets").select("*", { count: "exact", head: true }).neq("status", "closed"),
          supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("status", "resolved"),
          supabase.from("support_tickets").select("id,query,status,priority,created_at").order("created_at", { ascending: false }).limit(5),
        ]);
        assignedCount = assigned.count ?? 0;
        openCount = open.count ?? 0;
        resolvedCount = resolved.count ?? 0;
        recentTickets = (recentData.data ?? []) as SupportTicket[];
      }

      const [supportAnalytics, alertsList, knowledgeAnalytics] = await Promise.all([
        analyticsSupport(14).catch(() => null),
        analyticsListAlerts(false).catch(() => []),
        analyticsKnowledge().catch(() => null),
      ]);

      setStats({ assigned: assignedCount, open: openCount, resolved: resolvedCount });
      setRecent(recentTickets);

      if (supportAnalytics) {
        setAggregates(supportAnalytics.aggregates);
        setTrend(
          supportAnalytics.daily.map((d) => ({
            label: String(d.day ?? "").slice(5),
            value: Number(d.total_tickets ?? 0),
          })),
        );
      }
      setAlerts(alertsList);
      if (knowledgeAnalytics) {
        setKnowledge({
          total: knowledgeAnalytics.aggregates.total ?? 0,
          fresh: knowledgeAnalytics.aggregates.fresh ?? 0,
          aging: knowledgeAnalytics.aggregates.aging ?? 0,
          stale: knowledgeAnalytics.aggregates.stale ?? 0,
          coverage_pct: knowledgeAnalytics.aggregates.coverage_pct ?? null,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const topAlert = alerts[0];

  const narrative = aggregates
    ? `${aggregates.total_tickets ?? 0} tickets over the last 14 days, ${(aggregates.escalation_rate ?? 0)}% escalated, average resolution ${aggregates.avg_resolution_hours ?? 0}h.${
        stats.open > 0 ? ` ${stats.open} ticket${stats.open === 1 ? "" : "s"} currently open.` : " No open tickets right now."
      }`
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Support Dashboard"
        description="Triage tickets, respond to customers, and resolve issues."
        icon={<Headphones className="w-5 h-5" />}
      />

      {error ? <ErrorState message={error} /> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          {/* Anomaly / alert banner */}
          {topAlert ? (
            <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{topAlert.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{topAlert.message}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/admin/analytics-hub")}
              >
                Review
              </Button>
            </div>
          ) : null}

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Assigned to me" value={stats.assigned} icon={<Ticket className="w-5 h-5" />} />
            <StatCard label="Open tickets" value={stats.open} icon={<Clock className="w-5 h-5" />} />
            <StatCard label="Resolved" value={stats.resolved} icon={<CheckCircle2 className="w-5 h-5" />} />
            <StatCard
              label="Avg resolution"
              value={aggregates?.avg_resolution_hours != null ? `${aggregates.avg_resolution_hours}h` : "—"}
              icon={<BarChart3 className="w-5 h-5" />}
            />
          </div>

          {/* AI narrative summary */}
          {narrative ? (
            <div className="rounded-2xl surface-gradient border border-border/60 p-4 sm:p-5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">AI Narrative Summary</p>
                <p className="text-sm">{narrative}</p>
              </div>
            </div>
          ) : null}

          {/* Trend chart + today's queue */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <h2 className="text-sm font-semibold mb-3">Tickets — last 14 days</h2>
              {trend.length > 0 ? (
                <LineChart data={trend} height={220} />
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">No trend data available yet.</p>
              )}
            </Card>

            <Card>
              <h2 className="text-sm font-semibold mb-3">Today's queue</h2>
              {recent.length === 0 ? (
                <EmptyState
                  title="No tickets yet"
                  description="When customers raise tickets, they will appear here."
                  icon={<Headphones className="w-5 h-5" />}
                />
              ) : (
                <ul className="space-y-1">
                  {recent.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 p-2 rounded-lg hover:bg-accent/30">
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{t.query || "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.created_at ? new Date(t.created_at).toLocaleString() : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {t.priority ? <StatusPill status={t.priority} /> : null}
                        {t.status ? <StatusPill status={t.status} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Knowledge coverage / alerts / quick actions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <h2 className="text-sm font-semibold mb-3">Knowledge coverage</h2>
              {knowledge && knowledge.total > 0 ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Fresh</span>
                      <span className="font-medium tabular">{knowledge.fresh}/{knowledge.total}</span>
                    </div>
                    <ProgressBar value={knowledge.fresh} max={knowledge.total} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Aging</span>
                      <span className="font-medium tabular">{knowledge.aging}/{knowledge.total}</span>
                    </div>
                    <ProgressBar value={knowledge.aging} max={knowledge.total} color="var(--warning)" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Stale</span>
                      <span className="font-medium tabular">{knowledge.stale}/{knowledge.total}</span>
                    </div>
                    <ProgressBar value={knowledge.stale} max={knowledge.total} color="var(--destructive)" />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">No knowledge base documents yet.</p>
              )}
            </Card>

            <Card>
              <h2 className="text-sm font-semibold mb-3">Alerts</h2>
              {alerts.length === 0 ? (
                <EmptyState title="No active alerts" description="You're all caught up." icon={<AlertTriangle className="w-5 h-5" />} />
              ) : (
                <ul className="space-y-2">
                  {alerts.slice(0, 4).map((a) => (
                    <li key={a.id} className="text-xs p-2 rounded-lg border border-border">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{a.title}</span>
                        <StatusPill status={a.severity} />
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2">{a.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="text-sm font-semibold mb-3">Quick actions</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center flex flex-col items-center gap-1"
                >
                  <MessageSquare className="w-4 h-4" aria-hidden="true" /> Ask AI
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/knowledge")}
                  className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center flex flex-col items-center gap-1"
                >
                  <Search className="w-4 h-4" aria-hidden="true" /> Search KB
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/admin/support")}
                  className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center flex flex-col items-center gap-1"
                >
                  <Ticket className="w-4 h-4" aria-hidden="true" /> All tickets
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/admin/analytics-hub")}
                  className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center flex flex-col items-center gap-1"
                >
                  <BookOpen className="w-4 h-4" aria-hidden="true" /> Analytics
                </button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
