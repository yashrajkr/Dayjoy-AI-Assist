import { useCallback, useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { biOverview, biForecast, type BiOverview } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { LineChart } from "../../../common/Charts";
import { Button } from "../../../ui/button";
import { Section, KpiCard, fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function SalesPage() {
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [forecast, setForecast] = useState<Awaited<ReturnType<typeof biForecast>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, fc] = await Promise.all([biOverview(), biForecast()]);
      setOverview(ov);
      setForecast(fc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sales data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your sales…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!overview) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Sales</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Today" value={fmtInr(overview.today.sales_amount)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="This Week" value={fmtInr(overview.period.weekly_business)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="This Month" value={fmtInr(overview.period.monthly_business)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="This Year" value={fmtInr(overview.period.yearly_business)} icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      <AiMiniCard
        title="AI Sales Predictor"
        prompts={["Predict this month's sales.", "Why did my sales change this week?", "What should I do to boost sales this week?"]}
      />

      <Section title="90-Day Business Volume Trend" icon={<TrendingUp className="w-4 h-4 text-primary" />}>
        {forecast?.has_enough_data ? (
          <div>
            <LineChart data={(forecast.daily_history || []).map((d) => ({ label: d.date, value: d.bv }))} height={200} />
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                Trend: {forecast.trend_direction === "up" ? <TrendingUp className="w-3.5 h-3.5 text-success" /> : forecast.trend_direction === "down" ? <TrendingDown className="w-3.5 h-3.5 text-destructive" /> : <Minus className="w-3.5 h-3.5" />}
                {forecast.trend_direction}
              </span>
              <span>Projected next 30 days: <strong className="text-foreground">{fmtInr(forecast.next_30_day_projection)}</strong></span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center">{forecast?.message || "Not enough data yet to chart a trend."}</p>
        )}
      </Section>
    </div>
  );
}
