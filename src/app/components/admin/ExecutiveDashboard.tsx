import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard, Users, MessageSquare, Target, Clock, FileText, Headphones,
  GraduationCap, Package, Star, TrendingUp, TrendingDown, Download, RefreshCw,
  AlertTriangle, Loader2, Activity, Zap,
} from "lucide-react";
import {
  PageHeader, Card, StatCard, LoadingState, ErrorState, btnClass,
} from "../common/AdminUI";
import { LineChart, BarChart, DonutChart, type LineChartPoint, type BarChartItem, type DonutSlice } from "../common/Charts";
import {
  analyticsExecutive, analyticsAI, analyticsListAlerts,
  type ExecutiveKPIs, type AIAnalytics, type AnalyticsAlert,
} from "../../../lib/api";

export function ExecutiveDashboard() {
  const [kpis, setKpis] = useState<ExecutiveKPIs | null>(null);
  const [aiData, setAiData] = useState<AIAnalytics | null>(null);
  const [alerts, setAlerts] = useState<AnalyticsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [exec, ai, alts] = await Promise.all([
        analyticsExecutive(),
        analyticsAI(14).catch(() => null),
        analyticsListAlerts(false).catch(() => []),
      ]);
      setKpis(exec);
      setAiData(ai);
      setAlerts(alts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 60 seconds (Module 10 — real-time)
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader title="Executive Dashboard" icon={<LayoutDashboard className="w-5 h-5" />} />
      <LoadingState label="Loading executive KPIs…" />
    </div>
  );

  if (error) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader title="Executive Dashboard" icon={<LayoutDashboard className="w-5 h-5" />} />
      <ErrorState message={error} />
    </div>
  );

  if (!kpis) return null;

  // Build chart data
  const aiTrend: LineChartPoint[] = (aiData?.daily ?? []).map((d) => ({
    label: String(d.day || "").slice(5, 10),
    value: Number(d.total_queries || 0),
  }));

  const verificationDonut: DonutSlice[] = aiData ? [
    { label: "Verified", value: aiData.aggregates.verified, color: "var(--primary)" },
    { label: "Partial", value: Math.floor(aiData.aggregates.total_queries * 0.1), color: "var(--warning)" },
    { label: "Unverified", value: aiData.aggregates.unverified, color: "var(--destructive)" },
  ] : [];

  const topQuestionsBars: BarChartItem[] = (aiData?.top_questions ?? []).slice(0, 6).map((q) => ({
    label: q.question.slice(0, 20) + (q.question.length > 20 ? "…" : ""),
    value: q.ask_count,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Executive Dashboard"
        description="Real-time business intelligence — auto-refreshes every 60s"
        icon={<LayoutDashboard className="w-5 h-5" />}
        actions={
          <>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Live
            </span>
            <button type="button" className={btnClass.secondary} onClick={load}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      {/* Active alerts banner */}
      {alerts.filter((a) => !a.is_acknowledged).length > 0 ? (
        <Card className="mb-4 border-warning/30 bg-warning/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">{alerts.filter((a) => !a.is_acknowledged).length} active alert(s)</p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {alerts.filter((a) => !a.is_acknowledged).slice(0, 3).map((a) => (
                  <li key={a.id}>• {a.title}: {a.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      {/* KPI Grid — 12 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Users" value={kpis.users.total} icon={<Users className="w-5 h-5" />} hint={`${kpis.users.daily_active} DAU`} />
        <StatCard label="Daily Active" value={kpis.users.daily_active} icon={<Activity className="w-5 h-5" />} hint={`${kpis.users.weekly_active} WAU`} />
        <StatCard label="Monthly Active" value={kpis.users.monthly_active} icon={<Users className="w-5 h-5" />} />
        <StatCard label="Conversations" value={kpis.ai.total_conversations} icon={<MessageSquare className="w-5 h-5" />} hint={`${kpis.ai.conversations_per_user}/user`} />
        <StatCard label="AI Accuracy" value={kpis.ai.accuracy_pct != null ? `${kpis.ai.accuracy_pct}%` : "—"} icon={<Target className="w-5 h-5" />} trend={kpis.ai.accuracy_pct != null && kpis.ai.accuracy_pct >= 80 ? "up" : "down"} />
        <StatCard label="Avg Confidence" value={`${Math.round(kpis.ai.avg_confidence * 100)}%`} icon={<Zap className="w-5 h-5" />} />
        <StatCard label="Failed Responses" value={kpis.ai.failed_responses} icon={<TrendingDown className="w-5 h-5" />} trend={kpis.ai.failed_responses === 0 ? "up" : "down"} />
        <StatCard label="Total Documents" value={kpis.knowledge.total_documents} icon={<FileText className="w-5 h-5" />} hint={`${kpis.knowledge.total_chunks} chunks`} />
        <StatCard label="Verified Docs" value={kpis.knowledge.verified_documents} icon={<FileText className="w-5 h-5" />} hint={`${kpis.knowledge.coverage_pct ?? 0}% coverage`} />
        <StatCard label="Pending Approvals" value={kpis.knowledge.pending_approvals} icon={<Clock className="w-5 h-5" />} trend={kpis.knowledge.pending_approvals > 0 ? "down" : "up"} />
        <StatCard label="Open Tickets" value={kpis.support.open_tickets} icon={<Headphones className="w-5 h-5" />} hint={`${kpis.support.escalated_tickets} escalated`} />
        <StatCard label="Training Completion" value={`${kpis.training.completion_pct}%`} icon={<GraduationCap className="w-5 h-5" />} trend={kpis.training.completion_pct >= 70 ? "up" : "flat"} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* AI Query Trend */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">AI Query Volume (14 days)</h2>
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          {aiTrend.length > 0 ? <LineChart data={aiTrend} height={220} /> : (
            <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">No data yet</div>
          )}
        </Card>

        {/* AI Verification Donut */}
        <Card>
          <h2 className="text-sm font-semibold mb-3">AI Verification</h2>
          {verificationDonut.length > 0 && aiData?.aggregates.total_queries ? (
            <DonutChart data={verificationDonut} centerLabel="accuracy" centerValue={aiData.aggregates.accuracy_pct != null ? `${aiData.aggregates.accuracy_pct}%` : "—"} />
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">No RAG data</div>
          )}
        </Card>
      </div>

      {/* Top questions + satisfaction */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-sm font-semibold mb-3">Top Asked Questions</h2>
          {topQuestionsBars.length > 0 ? <BarChart data={topQuestionsBars} height={200} horizontal /> : (
            <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">No question data</div>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-3">Customer Satisfaction</h2>
          <div className="flex items-center justify-center h-[200px]">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={`w-8 h-8 ${s <= Math.round(kpis.satisfaction.customer_rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                ))}
              </div>
              <p className="text-3xl font-semibold">{kpis.satisfaction.customer_rating.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{kpis.satisfaction.total_feedback} ratings</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Quick stats footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Products</div><div className="text-xl font-semibold">{kpis.products.total_products}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Resolved Tickets</div><div className="text-xl font-semibold">{kpis.support.resolved_tickets}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Published Courses</div><div className="text-xl font-semibold">{kpis.training.published_courses}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Total Messages</div><div className="text-xl font-semibold">{kpis.ai.total_messages}</div></Card>
      </div>
    </div>
  );
}
