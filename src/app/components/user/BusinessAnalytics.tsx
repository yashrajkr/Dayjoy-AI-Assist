import { useCallback, useEffect, useState } from "react";
import { BarChart3, TrendingUp, Users, Target, Phone, Clock, DollarSign } from "lucide-react";
import { LoadingState, ErrorState } from "../common/AdminUI";
import { LineChart, BarChart, ProgressBar, type LineChartPoint, type BarChartItem } from "../common/Charts";
import { distributorAnalytics } from "../../../lib/api";
import { Card } from "../ui/card";

export function BusinessAnalytics() {
  const [data, setData] = useState<Awaited<ReturnType<typeof distributorAnalytics>> | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await distributorAnalytics(days);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><LoadingState /></div>;
  if (error) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><ErrorState message={error} /></div>;
  if (!data) return null;

  const salesTrend: LineChartPoint[] = data.daily_metrics.map((d) => ({
    label: String(d.metric_date || "").slice(5),
    value: Number(d.sales_amount || 0),
  }));

  const callsTrend: BarChartItem[] = data.daily_metrics.slice(-7).map((d) => ({
    label: String(d.metric_date || "").slice(8),
    value: Number(d.calls_made || 0),
  }));

  const healthScore = data.business_health_score != null ? Math.round(data.business_health_score) : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Business Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track your sales, calls, and business health.</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Health Score */}
      {healthScore != null ? (
        <Card className="p-4 mb-4 shadow-none">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><Target className="w-4 h-4 text-primary" /> Business Health Score</h2>
            <span className={`text-2xl font-bold ${healthScore >= 70 ? "text-primary" : healthScore >= 40 ? "text-warning" : "text-destructive"}`}>{healthScore}/100</span>
          </div>
          <ProgressBar value={healthScore} showLabel />
          <p className="text-[10px] text-muted-foreground mt-1">
            {healthScore >= 70 ? "Excellent! Your business is thriving." : healthScore >= 40 ? "Good progress. Keep pushing." : "Needs attention. Focus on follow-ups and customer engagement."}
          </p>
        </Card>
      ) : null}

      {/* Aggregates */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<DollarSign className="w-4 h-4" />} label="Total Sales" value={`₹${data.aggregates.total_sales.toLocaleString()}`} />
        <StatCard icon={<Phone className="w-4 h-4" />} label="Total Calls" value={data.aggregates.total_calls} />
        <StatCard icon={<Clock className="w-4 h-4" />} label="Follow-ups Done" value={data.aggregates.total_follow_ups} />
        <StatCard icon={<Users className="w-4 h-4" />} label="New Customers" value={data.aggregates.total_new_customers} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 shadow-none">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Sales Trend ({days}d)</h2>
          {salesTrend.length > 0 ? <LineChart data={salesTrend} height={200} /> : <p className="text-xs text-muted-foreground text-center py-8">No data yet.</p>}
        </Card>
        <Card className="p-4 shadow-none">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Phone className="w-4 h-4 text-primary" /> Calls (last 7 days)</h2>
          {callsTrend.length > 0 ? <BarChart data={callsTrend} height={200} /> : <p className="text-xs text-muted-foreground text-center py-8">No data yet.</p>}
        </Card>
      </div>

      {/* AI Usage */}
      <Card className="p-4 mt-4 shadow-none">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-primary" /> AI Usage</h2>
        <p className="text-2xl font-semibold">{data.aggregates.total_ai_queries} <span className="text-xs text-muted-foreground font-normal">queries in {days} days</span></p>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card className="p-3 shadow-none">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wide">{label}</span></div>
      <p className="text-xl font-semibold">{value}</p>
    </Card>
  );
}
