import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, Users, Headphones, BarChart3, AlertCircle,
  TrendingUp, FileText, Package, Brain, Clock, Target,
  XCircle, MessageSquare, GraduationCap,
} from "lucide-react";
import { BRAND } from "../../lib/brand";
import {
  PageHeader, Card, StatCard, LoadingState, ErrorState,
} from "../common/AdminUI";
import { Button } from "../ui/button";
import { LineChart, BarChart, DonutChart, type LineChartPoint, type BarChartItem, type DonutSlice } from "../common/Charts";
import {
  adminGetStats, adminAnalyticsSummary, adminTopProducts, adminTopQuestions,
  type AdminStats,
} from "../../../lib/api";
import { supabase } from "../../lib/supabaseClient";

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [trend, setTrend] = useState<LineChartPoint[]>([]);
  const [topProducts, setTopProducts] = useState<BarChartItem[]>([]);
  const [topQuestions, setTopQuestions] = useState<Array<{ question: string; ask_count: number; last_asked: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Try the backend admin API first
    let statsData: AdminStats | null = null;
    try {
      statsData = await adminGetStats();
      setStats(statsData);
    } catch {
      // Fall back to direct Supabase queries below
    }

    // Load trend data
    try {
      const summary = await adminAnalyticsSummary(14);
      setTrend(summary.days.map((d) => ({
        label: d.day.slice(0, 10),
        value: d.total_queries,
      })).reverse());
    } catch {
      setTrend([]);
    }

    // Load top products + questions
    try {
      const [products, questions] = await Promise.all([
        adminTopProducts(8),
        adminTopQuestions(8),
      ]);
      setTopProducts(products.map((p) => ({
        label: p.product_name?.slice(0, 20) || "—",
        value: p.view_count,
      })));
      setTopQuestions(questions);
    } catch {
      setTopProducts([]);
      setTopQuestions([]);
    }

    // Fallback: if backend not available, use Supabase directly
    if (!statsData && supabase) {
      try {
        const [users, tickets, chats, products, faqs, policies, docs] = await Promise.all([
          supabase.from("profiles").select("*", { count: "exact", head: true }),
          supabase.from("support_tickets").select("*", { count: "exact", head: true }).neq("status", "closed"),
          supabase.from("chat_conversations").select("*", { count: "exact", head: true }),
          supabase.from("products").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
          supabase.from("faqs").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
          supabase.from("policies").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
          supabase.from("knowledge_documents").select("*", { count: "exact", head: true }),
        ]);
        setStats({
          users: { total: users.count ?? 0, active_7d: users.count ?? 0 },
          ai: { conversations_today: chats.count ?? 0, total_rag_queries: 0, failed_queries: 0, accuracy_pct: null, escalations: 0, avg_response_time_ms: null },
          knowledge: {
            total_products: 0,
            total_documents: docs.count ?? 0,
            total_chunks: 0,
            pending_approvals: (products.count ?? 0) + (faqs.count ?? 0) + (policies.count ?? 0),
          },
          support: { pending_tickets: tickets.count ?? 0 },
          training: { avg_completion_pct: 0, course_count: 0 },
          top_products: [],
          top_questions: [],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPending = stats?.knowledge.pending_approvals ?? 0;

  // AI accuracy donut data
  const accuracyDonut: DonutSlice[] = stats?.ai.accuracy_pct != null ? [
    { label: "Verified", value: stats.ai.total_rag_queries - stats.ai.failed_queries, color: "var(--primary)" },
    { label: "Unverified", value: stats.ai.failed_queries, color: "var(--destructive)" },
  ] : [];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Executive Dashboard"
        description={`Real-time view of the ${BRAND.name} AI platform.`}
        icon={<LayoutDashboard className="w-5 h-5" />}
        actions={
          <Button type="button" variant="secondary" onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : stats ? (
        <>
          {/* Pending approvals banner */}
          {totalPending > 0 ? (
            <Card className="mb-6 border-warning/30 bg-warning/5">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-warning">
                    {totalPending} item{totalPending === 1 ? "" : "s"} awaiting approval
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Review pending products, FAQs, policies, and documents in the approval queue.
                  </p>
                </div>
                <Button asChild variant="secondary">
                  <Link to="/admin/approvals">Review</Link>
                </Button>
              </div>
            </Card>
          ) : null}

          {/* KPI grid — Module 1 metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Total Users"
              value={stats.users.total}
              hint={`${stats.users.active_7d} active (7d)`}
              icon={<Users className="w-5 h-5" />}
            />
            <StatCard
              label="AI Conversations Today"
              value={stats.ai.conversations_today}
              icon={<MessageSquare className="w-5 h-5" />}
            />
            <StatCard
              label="AI Accuracy"
              value={stats.ai.accuracy_pct != null ? `${stats.ai.accuracy_pct}%` : "—"}
              hint={stats.ai.failed_queries > 0 ? `${stats.ai.failed_queries} failed` : undefined}
              trend={stats.ai.accuracy_pct != null && stats.ai.accuracy_pct >= 80 ? "up" : "down"}
              icon={<Target className="w-5 h-5" />}
            />
            <StatCard
              label="Avg Response Time"
              value={stats.ai.avg_response_time_ms != null ? `${stats.ai.avg_response_time_ms}ms` : "—"}
              icon={<Clock className="w-5 h-5" />}
            />
            <StatCard
              label="Total Products"
              value={stats.knowledge.total_products}
              icon={<Package className="w-5 h-5" />}
            />
            <StatCard
              label="Knowledge Base Size"
              value={stats.knowledge.total_chunks}
              hint={`${stats.knowledge.total_documents} docs`}
              icon={<Brain className="w-5 h-5" />}
            />
            <StatCard
              label="Pending Tickets"
              value={stats.support.pending_tickets}
              icon={<Headphones className="w-5 h-5" />}
            />
            <StatCard
              label="Human Escalations"
              value={stats.ai.escalations}
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <StatCard
              label="Training Completion"
              value={`${stats.training.avg_completion_pct}%`}
              hint={`${stats.training.course_count} courses`}
              trend={stats.training.avg_completion_pct >= 70 ? "up" : "flat"}
              icon={<GraduationCap className="w-5 h-5" />}
            />
            <StatCard
              label="Pending Approvals"
              value={stats.knowledge.pending_approvals}
              icon={<FileText className="w-5 h-5" />}
            />
            <StatCard
              label="Failed AI Queries"
              value={stats.ai.failed_queries}
              trend={stats.ai.failed_queries === 0 ? "up" : "down"}
              icon={<XCircle className="w-5 h-5" />}
            />
            <StatCard
              label="Total RAG Queries"
              value={stats.ai.total_rag_queries}
              icon={<BarChart3 className="w-5 h-5" />}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* AI Query Trend */}
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">AI Query Volume (14 days)</h2>
                <Link to="/admin/analytics" className="text-xs text-primary hover:underline">
                  View analytics →
                </Link>
              </div>
              {trend.length > 0 ? (
                <LineChart data={trend} height={220} />
              ) : (
                <div className="flex items-center justify-center text-xs text-muted-foreground h-[220px]">
                  No query data yet — analytics populate as users interact with the AI.
                </div>
              )}
            </Card>

            {/* AI Accuracy donut */}
            <Card>
              <h2 className="text-sm font-semibold mb-3">AI Verification</h2>
              {accuracyDonut.length > 0 ? (
                <DonutChart
                  data={accuracyDonut}
                  centerLabel="accuracy"
                  centerValue={stats.ai.accuracy_pct != null ? `${stats.ai.accuracy_pct}%` : ""}
                />
              ) : (
                <div className="flex items-center justify-center text-xs text-muted-foreground h-[220px]">
                  RAG subsystem not yet active — enable to see verification stats.
                </div>
              )}
            </Card>
          </div>

          {/* Top products + questions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Most Viewed Products</h2>
                <Link to="/admin/products" className="text-xs text-primary hover:underline">
                  Manage →
                </Link>
              </div>
              {topProducts.length > 0 ? (
                <BarChart data={topProducts} height={200} horizontal />
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No product views recorded yet.
                </p>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Most Asked Questions</h2>
                <Link to="/admin/analytics" className="text-xs text-primary hover:underline">
                  View all →
                </Link>
              </div>
              {topQuestions.length > 0 ? (
                <ul className="space-y-2">
                  {topQuestions.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 p-2 rounded-lg hover:bg-accent/30">
                      <span className="text-[10px] font-mono text-muted-foreground mt-0.5 w-6 shrink-0">#{i + 1}</span>
                      <p className="text-xs flex-1 min-w-0 truncate">{q.question}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{q.ask_count}×</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No question data yet.
                </p>
              )}
            </Card>
          </div>

          {/* Quick actions */}
          <Card>
            <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Link to="/admin/knowledge" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Upload Document
              </Link>
              <Link to="/admin/products" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Add Product
              </Link>
              <Link to="/admin/faqs" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Add FAQ
              </Link>
              <Link to="/admin/training" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Create Course
              </Link>
              <Link to="/admin/users" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Manage Users
              </Link>
              <Link to="/admin/ai-config" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                AI Config
              </Link>
              <Link to="/admin/roles" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Role Permissions
              </Link>
              <Link to="/admin/audit" className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent/60 text-center">
                Audit Logs
              </Link>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
