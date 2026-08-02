import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download, TrendingUp, Users, MessageSquare, ShieldAlert, AlertCircle } from "lucide-react";
import { getAnalytics, type AnalyticsEvent } from "../../lib/db";
import { PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import { BarChart, LineChart, DonutChart } from "../common/Charts";
import { Button } from "../ui/button";
import { adminKnowledgeGaps } from "../../../lib/api";

function computeStats(events: AnalyticsEvent[]) {
  const totalQueries = events.length;

  const roleWise = events.reduce<Record<string, number>>((acc, e) => {
    const key = e.role ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const categoryUsage = events.reduce<Record<string, number>>((acc, e) => {
    const key = e.category ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const languageUsage = events.reduce<Record<string, number>>((acc, e) => {
    const key = e.language ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Daily query trend (last 14 days)
  const dailyTrend: Record<string, number> = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyTrend[key] = 0;
  }
  for (const e of events) {
    if (!e.created_at) continue;
    const key = e.created_at.slice(0, 10);
    if (key in dailyTrend) dailyTrend[key]++;
  }

  const unansweredQueries = events.filter((e) => !e.query).length;
  const unsafeBlockedQueries = events.filter((e) => e.safety_status === "unsafe").length;

  return {
    totalQueries,
    roleWise,
    categoryUsage,
    languageUsage,
    dailyTrend,
    unansweredQueries,
    unsafeBlockedQueries,
  };
}

const CHART_COLORS = [
  "var(--primary)",
  "var(--secondary)",
  "var(--gold-accent)",
  "var(--warning)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

export function AdminAnalytics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [gaps, setGaps] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const rows = await getAnalytics();
        if (!cancelled) setEvents(rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load analytics";
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Load knowledge gaps from backend
      try {
        const gapRows = await adminKnowledgeGaps(20);
        if (!cancelled) setGaps(gapRows);
      } catch { /* ignore — backend may be unavailable */ }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => computeStats(events), [events]);

  const exportCsv = () => {
    const headers = ["created_at", "role", "language", "query", "category", "safety_status"];
    const rows = events.map((e) =>
      [e.created_at, e.role, e.language, e.query, e.category, e.safety_status]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dayjoy-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Analytics Dashboard"
        description="Track AI performance, user engagement, and business insights."
        icon={<BarChart3 className="w-5 h-5" />}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={exportCsv}
            disabled={events.length === 0}
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
          </Button>
        }
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading analytics…" />
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            title="No analytics yet"
            description="Events will appear here after users submit leads or ask questions."
            icon={<BarChart3 className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Total queries" value={stats.totalQueries} icon={<MessageSquare className="w-5 h-5" />} />
            <StatCard label="Roles active" value={Object.keys(stats.roleWise).length} icon={<Users className="w-5 h-5" />} />
            <StatCard label="Unanswered" value={stats.unansweredQueries} icon={<TrendingUp className="w-5 h-5" />} />
            <StatCard label="Blocked" value={stats.unsafeBlockedQueries} icon={<ShieldAlert className="w-5 h-5" />} />
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Daily trend line chart */}
            <Card>
              <h3 className="text-sm font-semibold mb-3">Queries — last 14 days</h3>
              <LineChart
                data={Object.entries(stats.dailyTrend).map(([date, count]) => ({
                  label: date.slice(5),
                  value: count,
                }))}
                height={180}
              />
            </Card>

            {/* Category usage bar chart */}
            <Card>
              <h3 className="text-sm font-semibold mb-3">Queries by category</h3>
              <BarChart
                data={Object.entries(stats.categoryUsage).map(([label, value]) => ({ label, value }))}
                height={180}
              />
            </Card>

            {/* Role distribution donut */}
            <Card>
              <h3 className="text-sm font-semibold mb-3">Role distribution</h3>
              <DonutChart
                data={Object.entries(stats.roleWise).map(([label, value], i) => ({
                  label,
                  value,
                  color: CHART_COLORS[i % CHART_COLORS.length],
                }))}
              />
            </Card>

            {/* Language distribution donut */}
            <Card>
              <h3 className="text-sm font-semibold mb-3">Language distribution</h3>
              <DonutChart
                data={Object.entries(stats.languageUsage).map(([label, value], i) => ({
                  label,
                  value,
                  color: CHART_COLORS[i % CHART_COLORS.length],
                }))}
              />
            </Card>
          </div>

          {/* Knowledge Gaps — failed/low-confidence queries */}
          {gaps.length > 0 ? (
            <Card className="mt-6 border-warning/30 bg-warning/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-warning" />
                <h3 className="text-sm font-semibold text-warning">Knowledge Gaps — Unresolved Low-Confidence Queries</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                These questions could not be answered from approved knowledge. Consider uploading documents that address them.
              </p>
              <ul className="space-y-1.5">
                {gaps.slice(0, 10).map((g, i) => (
                  <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border">
                    <span className="text-[10px] font-mono text-muted-foreground w-6 shrink-0">#{i + 1}</span>
                    <p className="text-xs flex-1 min-w-0 truncate">{String(g.query_text ?? "—")}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {String(g.occurrence_count ?? 1)}× asked
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      conf: {String(g.confidence ?? "—")}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
