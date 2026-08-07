import { useCallback, useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { biGoalsProgress } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { ProgressBar } from "../../../common/Charts";
import { Button } from "../../../ui/button";
import { fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function TargetsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof biGoalsProgress>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await biGoalsProgress());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load targets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your targets…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Flag className="w-5 h-5 text-primary" /> Targets</h1>
      <p className="text-xs text-muted-foreground">Business-volume targets by period, set by you or your upline. Configure targets from Settings.</p>

      <AiMiniCard
        title="AI Success Probability"
        prompts={["What's my probability of hitting this month's target?", "How much do I need to sell per day to hit target?"]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(data.periods).map(([period, g]) => (
          <div key={period} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="capitalize font-medium">{period}</span>
              <span className="text-muted-foreground">{g.progress_pct != null ? `${g.progress_pct}%` : "no target set"}</span>
            </div>
            <ProgressBar value={g.progress_pct || 0} showLabel={false} />
            <p className="text-xs text-muted-foreground mt-2">{fmtInr(g.actual)}{g.target ? ` of ${fmtInr(g.target)}` : ""}</p>
            {g.target && g.progress_pct != null && g.progress_pct < 100 ? (
              <p className="text-[11px] text-muted-foreground mt-1">{fmtInr(g.target - g.actual)} remaining</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
