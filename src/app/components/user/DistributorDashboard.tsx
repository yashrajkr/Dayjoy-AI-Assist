import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, Users, Phone, TrendingUp, Target, Sparkles, Calendar,
  Clock, AlertTriangle, Award, MessageSquare,
  Lightbulb,
} from "lucide-react";
import { distributorDashboard, type DistributorDashboard as DashboardData } from "../../../lib/api";
import { LoadingState, ErrorState } from "../common/AdminUI";
import { ProgressBar } from "../common/Charts";

export function DistributorDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await distributorDashboard();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <LoadingState label="Loading your dashboard…" />
    </div>
  );

  if (error) return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <ErrorState message={error} />
      <button type="button" onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
        Retry
      </button>
    </div>
  );

  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <LayoutDashboard className="w-5 h-5 text-primary" />
        <h1 className="text-xl sm:text-2xl font-semibold">My Dashboard</h1>
      </div>

      {/* AI Suggestions banner */}
      {data.suggestions.length > 0 ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary mb-1">AI Suggestion</p>
              <p className="text-sm">{String(data.suggestions[0].title || "")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{String(data.suggestions[0].body || "")}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Today's Sales" value={`₹${data.today.sales_amount}`} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Calls Today" value={data.today.calls_made} icon={<Phone className="w-4 h-4" />} />
        <KpiCard label="Active Customers" value={data.customers.active} icon={<Users className="w-4 h-4" />} />
        <KpiCard label="Pending Follow-ups" value={data.follow_ups.pending} icon={<Clock className="w-4 h-4" />} />
        <KpiCard label="Overdue" value={data.follow_ups.overdue} icon={<AlertTriangle className="w-4 h-4" />} trend={data.follow_ups.overdue > 0 ? "down" : "flat"} />
        <KpiCard label="Team Size" value={data.team.active} icon={<Award className="w-4 h-4" />} />
        <KpiCard label="AI Queries" value={data.today.ai_queries} icon={<MessageSquare className="w-4 h-4" />} />
        <KpiCard label="Health Score" value={data.business_health_score != null ? `${Math.round(data.business_health_score)}/100` : "—"} icon={<Target className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily Goals */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Target className="w-4 h-4 text-primary" /> Daily Goals
            </h2>
            <Link to="/distributor/goals" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          {data.goals.daily.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No daily goals set.</p>
          ) : (
            <div className="space-y-2">
              {data.goals.daily.slice(0, 4).map((g) => {
                const target = Number(g.target_value || 0);
                const current = Number(g.current_value || 0);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                return (
                  <div key={String(g.id)}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="capitalize">{String(g.category || "goal")}</span>
                      <span className="text-muted-foreground">{current}/{target}</span>
                    </div>
                    <ProgressBar value={pct} showLabel />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Follow-ups */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" /> Follow-ups
            </h2>
            <Link to="/distributor/follow-ups" className="text-xs text-primary hover:underline">Manage</Link>
          </div>
          {data.follow_ups.recent.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No follow-ups scheduled.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.follow_ups.recent.slice(0, 5).map((f) => {
                const due = new Date(String(f.due_date || ""));
                const isOverdue = due < new Date() && f.status === "pending";
                return (
                  <li key={String(f.id)} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-accent/30">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOverdue ? "bg-destructive" : f.status === "completed" ? "bg-primary" : "bg-warning"}`} />
                    <span className="flex-1 truncate">{String(f.title || "Untitled")}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{due.toLocaleDateString()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent AI Content */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-primary" /> Recent AI Content
            </h2>
            <Link to="/distributor/content" className="text-xs text-primary hover:underline">Generate</Link>
          </div>
          {data.recent_content.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No content generated yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.recent_content.slice(0, 4).map((c) => (
                <li key={String(c.id)} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-accent/30">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground uppercase shrink-0">{String(c.content_type || "").slice(0, 4)}</span>
                  <span className="flex-1 truncate">{String(c.title || c.content || "").slice(0, 50)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming Events */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-primary" /> Upcoming Events
            </h2>
          </div>
          {data.upcoming_events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No upcoming events.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.upcoming_events.slice(0, 3).map((e) => (
                <li key={String(e.id)} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-accent/30">
                  <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{String(e.title || "Event")}</p>
                    <p className="text-[10px] text-muted-foreground">{e.start_time ? new Date(String(e.start_time)).toLocaleString() : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-primary" /> Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Link to="/distributor/customers" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
            <Users className="w-3.5 h-3.5 mx-auto mb-1" /> Customers
          </Link>
          <Link to="/distributor/follow-ups" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
            <Clock className="w-3.5 h-3.5 mx-auto mb-1" /> Follow-ups
          </Link>
          <Link to="/distributor/content" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
            <MessageSquare className="w-3.5 h-3.5 mx-auto mb-1" /> Content
          </Link>
          <Link to="/distributor/analytics" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
            <TrendingUp className="w-3.5 h-3.5 mx-auto mb-1" /> Analytics
          </Link>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, trend }: { label: string; value: string | number; icon: React.ReactNode; trend?: "up" | "down" | "flat" }) {
  const trendColor = trend === "up" ? "text-primary" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <div className="text-primary">{icon}</div>
      </div>
      <p className={`text-xl font-semibold ${trendColor}`}>{value}</p>
    </div>
  );
}
