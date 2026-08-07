import { useCallback, useEffect, useState } from "react";
import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { biInsights, biForecast } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { LineChart } from "../../../common/Charts";
import { Button } from "../../../ui/button";
import { Section, fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function AIInsightsPage() {
  const [insights, setInsights] = useState<string[]>([]);
  const [forecast, setForecast] = useState<Awaited<ReturnType<typeof biForecast>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ins, fc] = await Promise.all([biInsights(), biForecast()]);
      setInsights(ins.insights);
      setForecast(fc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Generating AI insights…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> AI Insights</h1>

      <Section title="What's happening in your business" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        {insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground py-2">No insights yet — check back as your business activity grows.</p>
        )}
      </Section>

      {forecast?.has_enough_data ? (
        <Section title="Trend & Forecast" icon={<TrendingUp className="w-4 h-4 text-primary" />}>
          <LineChart data={(forecast.daily_history || []).map((d) => ({ label: d.date, value: d.bv }))} height={180} />
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              Trend: {forecast.trend_direction === "up" ? <TrendingUp className="w-3.5 h-3.5 text-success" /> : forecast.trend_direction === "down" ? <TrendingDown className="w-3.5 h-3.5 text-destructive" /> : <Minus className="w-3.5 h-3.5" />}
              {forecast.trend_direction}
            </span>
            <span>Projected next 30 days: <strong className="text-foreground">{fmtInr(forecast.next_30_day_projection)}</strong></span>
          </div>
        </Section>
      ) : null}

      <AiMiniCard
        title="Ask AI About Your Business"
        prompts={["Why did my revenue change this month?", "What's my biggest opportunity right now?", "Summarize my business in 3 sentences."]}
      />
    </div>
  );
}
