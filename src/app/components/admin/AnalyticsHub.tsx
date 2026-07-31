import { useCallback, useEffect, useState } from "react";
import {
  BarChart3, Brain, Package, Users, UserCheck, Database, Headphones,
  GraduationCap, Activity, AlertTriangle, Download, RefreshCw, Loader2,
  CheckCircle, XCircle, Clock, TrendingUp,
} from "lucide-react";
import {
  PageHeader, Card, StatCard, LoadingState, ErrorState, btnClass,
} from "../common/AdminUI";
import { LineChart, BarChart, DonutChart, ProgressBar, type LineChartPoint, type BarChartItem, type DonutSlice } from "../common/Charts";
import {
  analyticsAI, analyticsProducts, analyticsDistributors, analyticsCustomers,
  analyticsKnowledge, analyticsSupport, analyticsTraining, analyticsHealth,
  analyticsListAlerts, analyticsUpdateAlert, analyticsExport, analyticsRefresh,
} from "../../../lib/api";
import type { AnalyticsAlert } from "../../../lib/api";

type Tab = "ai" | "products" | "distributors" | "customers" | "knowledge" | "support" | "training" | "health" | "alerts";

const TABS: { value: Tab; label: string; icon: typeof Brain }[] = [
  { value: "ai", label: "AI", icon: Brain },
  { value: "products", label: "Products", icon: Package },
  { value: "distributors", label: "Distributors", icon: Users },
  { value: "customers", label: "Customers", icon: UserCheck },
  { value: "knowledge", label: "Knowledge", icon: Database },
  { value: "support", label: "Support", icon: Headphones },
  { value: "training", label: "Training", icon: GraduationCap },
  { value: "health", label: "System Health", icon: Activity },
  { value: "alerts", label: "Alerts", icon: AlertTriangle },
];

export function AnalyticsHub() {
  const [tab, setTab] = useState<Tab>("ai");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case "ai": setData(await analyticsAI(30)); break;
        case "products": setData(await analyticsProducts(30)); break;
        case "distributors": setData(await analyticsDistributors(50)); break;
        case "customers": setData(await analyticsCustomers(30)); break;
        case "knowledge": setData(await analyticsKnowledge()); break;
        case "support": setData(await analyticsSupport(30)); break;
        case "training": setData(await analyticsTraining()); break;
        case "health": setData(await analyticsHealth()); break;
        case "alerts": setData(await analyticsListAlerts(false)); break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await analyticsExport(tab, 30);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tab}_analytics_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ } finally { setExporting(false); }
  };

  const handleRefresh = async () => {
    try { await analyticsRefresh(); await load(); } catch { /* ignore */ }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Analytics Hub"
        description="Executive business intelligence across AI, products, distributors, customers, knowledge, support, and training."
        icon={<BarChart3 className="w-5 h-5" />}
        actions={
          <>
            <button type="button" className={btnClass.secondary} onClick={handleRefresh} title="Refresh materialized views">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {tab !== "health" && tab !== "alerts" ? (
              <button type="button" className={btnClass.secondary} onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export CSV
              </button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto scrollbar-thin">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 whitespace-nowrap transition-colors ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState label={`Loading ${tab} analytics…`} /> : (
        <>
          {/* AI Analytics */}
          {tab === "ai" && data ? <AIAnalyticsView data={data} /> : null}
          {/* Product Analytics */}
          {tab === "products" && data ? <ProductAnalyticsView data={data} /> : null}
          {/* Distributor Analytics */}
          {tab === "distributors" && data ? <DistributorAnalyticsView data={data} /> : null}
          {/* Customer Analytics */}
          {tab === "customers" && data ? <CustomerAnalyticsView data={data} /> : null}
          {/* Knowledge Analytics */}
          {tab === "knowledge" && data ? <KnowledgeAnalyticsView data={data} /> : null}
          {/* Support Analytics */}
          {tab === "support" && data ? <SupportAnalyticsView data={data} /> : null}
          {/* Training Analytics */}
          {tab === "training" && data ? <TrainingAnalyticsView data={data} /> : null}
          {/* System Health */}
          {tab === "health" && data ? <HealthMonitorView data={data} /> : null}
          {/* Alerts */}
          {tab === "alerts" && data ? <AlertsView alerts={data} onUpdate={load} /> : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Analytics View
// ---------------------------------------------------------------------------
function AIAnalyticsView({ data }: { data: any }) {
  const trend: LineChartPoint[] = (data.daily || []).map((d: any) => ({
    label: String(d.day || "").slice(5, 10),
    value: Number(d.total_queries || 0),
  }));
  const confTrend: LineChartPoint[] = (data.daily || []).map((d: any) => ({
    label: String(d.day || "").slice(5, 10),
    value: Math.round(Number(d.avg_confidence || 0) * 100),
  }));
  const donut: DonutSlice[] = [
    { label: "Verified", value: data.aggregates.verified, color: "var(--primary)" },
    { label: "Unverified", value: data.aggregates.unverified, color: "var(--destructive)" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Queries" value={data.aggregates.total_queries} icon={<Brain className="w-5 h-5" />} />
        <StatCard label="AI Accuracy" value={data.aggregates.accuracy_pct != null ? `${data.aggregates.accuracy_pct}%` : "—"} icon={<TrendingUp className="w-5 h-5" />} trend="up" />
        <StatCard label="Avg Confidence" value={`${Math.round(data.aggregates.avg_confidence * 100)}%`} icon={<Brain className="w-5 h-5" />} />
        <StatCard label="Avg Latency" value={`${data.aggregates.avg_latency_ms}ms`} icon={<Clock className="w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Query Volume Trend</h3>{trend.length > 0 ? <LineChart data={trend} height={200} /> : <Empty />}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Confidence Trend (%)</h3>{confTrend.length > 0 ? <LineChart data={confTrend} height={200} color="var(--warning)" /> : <Empty />}</Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Verification Breakdown</h3>{donut[0].value + donut[1].value > 0 ? <DonutChart data={donut} centerLabel="verified" centerValue={`${data.aggregates.total_queries > 0 ? Math.round(data.aggregates.verified / data.aggregates.total_queries * 100) : 0}%`} /> : <Empty />}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Top Questions</h3>
          {data.top_questions?.length > 0 ? (
            <ul className="space-y-1.5">{data.top_questions.slice(0, 8).map((q: any, i: number) => (
              <li key={i} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-accent/30">
                <span className="text-[10px] font-mono text-muted-foreground w-5">#{i + 1}</span>
                <span className="flex-1 truncate">{q.question}</span>
                <span className="text-[10px] text-muted-foreground">{q.ask_count}×</span>
              </li>
            ))}</ul>
          ) : <Empty />}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Analytics View
// ---------------------------------------------------------------------------
function ProductAnalyticsView({ data }: { data: any }) {
  const bars: BarChartItem[] = (data.products || []).slice(0, 10).map((p: any) => ({
    label: String(p.product_name || "").slice(0, 15),
    value: Number(p.view_count || 0),
  }));
  const catBars: BarChartItem[] = (data.category_popularity || []).slice(0, 8).map((c: any) => ({
    label: c.category, value: c.views,
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Views" value={data.total_views} icon={<Package className="w-5 h-5" />} />
        <StatCard label="Total Favorites" value={data.total_favorites} icon={<Package className="w-5 h-5" />} />
        <StatCard label="Products Tracked" value={data.products?.length} icon={<Package className="w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Top Products by Views</h3>{bars.length > 0 ? <BarChart data={bars} height={220} horizontal /> : <Empty />}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Category Popularity</h3>{catBars.length > 0 ? <BarChart data={catBars} height={220} horizontal /> : <Empty />}</Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distributor Analytics View
// ---------------------------------------------------------------------------
function DistributorAnalyticsView({ data }: { data: any }) {
  const a = data.aggregates || {};
  const topDist: BarChartItem[] = (data.distributors || []).slice(0, 10).map((d: any) => ({
    label: String(d.full_name || "").slice(0, 12),
    value: Number(d.ai_queries || 0),
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Distributors" value={a.total_distributors} icon={<Users className="w-5 h-5" />} />
        <StatCard label="Customers" value={a.total_customers} icon={<UserCheck className="w-5 h-5" />} />
        <StatCard label="Follow-ups" value={a.total_follow_ups} icon={<Clock className="w-5 h-5" />} />
        <StatCard label="AI Queries" value={a.total_ai_queries} icon={<Brain className="w-5 h-5" />} />
      </div>
      <Card><h3 className="text-sm font-semibold mb-3">Top Distributors by AI Usage</h3>{topDist.length > 0 ? <BarChart data={topDist} height={220} horizontal /> : <Empty />}</Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2 border-b border-border"><h3 className="text-sm font-semibold">Distributor Leaderboard</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-accent/50 border-b border-border"><tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Customers</th>
              <th className="px-3 py-2 text-right">Follow-ups</th>
              <th className="px-3 py-2 text-right">Content</th>
              <th className="px-3 py-2 text-right">Team</th>
              <th className="px-3 py-2 text-right">AI</th>
            </tr></thead>
            <tbody>
              {(data.distributors || []).slice(0, 15).map((d: any, i: number) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium">{d.full_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.customer_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.follow_up_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.content_generated}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.team_size}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.ai_queries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer Analytics View
// ---------------------------------------------------------------------------
function CustomerAnalyticsView({ data }: { data: any }) {
  const trend: LineChartPoint[] = (data.daily || []).map((d: any) => ({
    label: String(d.registration_day || "").slice(5, 10),
    value: Number(d.new_registrations || 0),
  }));
  const a = data.aggregates || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Registrations" value={a.total_registrations} icon={<UserCheck className="w-5 h-5" />} />
        <StatCard label="Onboarded" value={a.completed_onboarding} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard label="Active (7d)" value={a.active_this_week} icon={<Activity className="w-5 h-5" />} />
        <StatCard label="Satisfaction" value={a.satisfaction ? a.satisfaction.toFixed(1) : "—"} icon={<TrendingUp className="w-5 h-5" />} />
      </div>
      <Card><h3 className="text-sm font-semibold mb-3">Daily Registrations</h3>{trend.length > 0 ? <LineChart data={trend} height={220} /> : <Empty />}</Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge Analytics View
// ---------------------------------------------------------------------------
function KnowledgeAnalyticsView({ data }: { data: any }) {
  const a = data.aggregates || {};
  const freshness: DonutSlice[] = [
    { label: "Fresh", value: a.fresh || 0, color: "var(--primary)" },
    { label: "Aging", value: a.aging || 0, color: "var(--warning)" },
    { label: "Stale", value: a.stale || 0, color: "var(--destructive)" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Docs" value={a.total} icon={<Database className="w-5 h-5" />} />
        <StatCard label="Coverage" value={`${a.coverage_pct ?? 0}%`} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard label="Avg References" value={a.avg_references ?? 0} icon={<TrendingUp className="w-5 h-5" />} />
        <StatCard label="Stale Docs" value={a.stale} icon={<Clock className="w-5 h-5" />} trend={a.stale > 0 ? "down" : "up"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Document Freshness</h3>{freshness[0].value + freshness[1].value + freshness[2].value > 0 ? <DonutChart data={freshness} centerLabel="docs" centerValue={a.total} /> : <Empty />}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Most Referenced</h3>
          {(data.documents || []).length > 0 ? (
            <ul className="space-y-1.5">{data.documents.slice(0, 8).map((d: any, i: number) => (
              <li key={i} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-accent/30">
                <span className="text-[10px] font-mono text-muted-foreground w-5">#{i + 1}</span>
                <span className="flex-1 truncate">{d.file_name}</span>
                <span className="text-[10px] text-muted-foreground">{d.reference_count} refs</span>
              </li>
            ))}</ul>
          ) : <Empty />}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support Analytics View
// ---------------------------------------------------------------------------
function SupportAnalyticsView({ data }: { data: any }) {
  const trend: LineChartPoint[] = (data.daily || []).map((d: any) => ({
    label: String(d.day || "").slice(5, 10),
    value: Number(d.total_tickets || 0),
  }));
  const a = data.aggregates || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Tickets" value={a.total_tickets} icon={<Headphones className="w-5 h-5" />} />
        <StatCard label="Resolved" value={a.resolved} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard label="Escalation Rate" value={`${a.escalation_rate ?? 0}%`} icon={<AlertTriangle className="w-5 h-5" />} trend={a.escalation_rate > 10 ? "down" : "up"} />
        <StatCard label="Avg Resolution" value={`${a.avg_resolution_hours ?? 0}h`} icon={<Clock className="w-5 h-5" />} />
      </div>
      <Card><h3 className="text-sm font-semibold mb-3">Ticket Volume Trend</h3>{trend.length > 0 ? <LineChart data={trend} height={220} color="var(--warning)" /> : <Empty />}</Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Training Analytics View
// ---------------------------------------------------------------------------
function TrainingAnalyticsView({ data }: { data: any }) {
  const a = data.aggregates || {};
  const bars: BarChartItem[] = (data.courses || []).slice(0, 10).map((c: any) => ({
    label: String(c.course_title || "").slice(0, 15),
    value: Number(c.total_enrollments || 0),
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Courses" value={a.total_courses} icon={<GraduationCap className="w-5 h-5" />} />
        <StatCard label="Enrollments" value={a.total_enrollments} icon={<Users className="w-5 h-5" />} />
        <StatCard label="Completed" value={a.completed} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard label="Certificates" value={a.certificates_issued} icon={<CheckCircle className="w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Enrollments by Course</h3>{bars.length > 0 ? <BarChart data={bars} height={220} horizontal /> : <Empty />}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Completion Rate</h3>
          <div className="flex items-center justify-center h-[220px]">
            <div className="text-center">
              <p className="text-4xl font-semibold text-primary">{a.completion_pct ?? 0}%</p>
              <p className="text-xs text-muted-foreground mt-1">{a.completed} of {a.total_enrollments} enrollments</p>
              <div className="w-48 mt-3 mx-auto"><ProgressBar value={a.completion_pct ?? 0} showLabel /></div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Health Monitor View
// ---------------------------------------------------------------------------
function HealthMonitorView({ data }: { data: any }) {
  const components = data.components || {};
  return (
    <div className="space-y-4">
      <Card className={`${data.overall_status === "healthy" ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5"}`}>
        <div className="flex items-center gap-3">
          {data.overall_status === "healthy" ? <CheckCircle className="w-8 h-8 text-primary" /> : <AlertTriangle className="w-8 h-8 text-warning" />}
          <div>
            <p className="text-lg font-semibold capitalize">{data.overall_status}</p>
            <p className="text-xs text-muted-foreground">Last checked: {data.timestamp}</p>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(components).map(([key, comp]: [string, any]) => (
          <Card key={key} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium capitalize">{key.replace("_", " ")}</h3>
              {comp.status === "ok" ? <CheckCircle className="w-5 h-5 text-primary" /> : comp.status === "not_configured" ? <Clock className="w-5 h-5 text-muted-foreground" /> : <XCircle className="w-5 h-5 text-destructive" />}
            </div>
            <p className="text-xs text-muted-foreground capitalize">{comp.status.replace("_", " ")}</p>
            {comp.latency_ms != null ? <p className="text-[10px] text-muted-foreground mt-1">Latency: {comp.latency_ms}ms</p> : null}
          </Card>
        ))}
      </div>
      <Card>
        <h3 className="text-sm font-semibold mb-2">Storage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="text-center"><p className="text-lg font-semibold">{data.storage?.documents ?? 0}</p><p className="text-muted-foreground">Documents</p></div>
          <div className="text-center"><p className="text-lg font-semibold">{data.storage?.chunks ?? 0}</p><p className="text-muted-foreground">Chunks</p></div>
          <div className="text-center"><p className="text-lg font-semibold">{data.storage?.embeddings ?? 0}</p><p className="text-muted-foreground">Embeddings</p></div>
          <div className="text-center"><p className="text-lg font-semibold text-warning">{data.storage?.chunks_without_embeddings ?? 0}</p><p className="text-muted-foreground">Unindexed</p></div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts View
// ---------------------------------------------------------------------------
function AlertsView({ alerts, onUpdate }: { alerts: AnalyticsAlert[]; onUpdate: () => void }) {
  const handleAck = async (a: AnalyticsAlert) => {
    try { await analyticsUpdateAlert(a.id, { is_acknowledged: true }); onUpdate(); } catch { /* ignore */ }
  };
  const handleResolve = async (a: AnalyticsAlert) => {
    try { await analyticsUpdateAlert(a.id, { is_resolved: true }); onUpdate(); } catch { /* ignore */ }
  };
  if (alerts.length === 0) return <Card><div className="text-center py-8"><CheckCircle className="w-10 h-10 text-primary mx-auto mb-2" /><p className="text-sm font-medium">No active alerts</p><p className="text-xs text-muted-foreground">All systems healthy.</p></div></Card>;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <Card key={a.id} className={`border-l-4 ${a.severity === "critical" ? "border-l-destructive" : a.severity === "warning" ? "border-l-warning" : "border-l-primary"}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${a.severity === "critical" ? "text-destructive" : "text-warning"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{a.title}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase ${a.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>{a.severity}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{a.message}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString()}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              {!a.is_acknowledged ? <button type="button" onClick={() => handleAck(a)} className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent">Ack</button> : null}
              {!a.is_resolved ? <button type="button" onClick={() => handleResolve(a)} className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10">Resolve</button> : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Empty() { return <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">No data available</div>; }
