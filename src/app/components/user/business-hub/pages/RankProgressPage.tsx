import { useCallback, useEffect, useState } from "react";
import { Award } from "lucide-react";
import { biOverview, type BiOverview } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { ProgressBar } from "../../../common/Charts";
import { Button } from "../../../ui/button";
import { Section, fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function RankProgressPage() {
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await biOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rank progress");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your rank progress…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!overview) return null;

  const r = overview.rank;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Award className="w-5 h-5 text-primary" /> Rank Progress</h1>

      <AiMiniCard
        title="AI Rank Coach"
        prompts={["What should I do to reach my next rank fastest?", "When will I likely hit my next rank?"]}
      />

      <Section title="Current Standing" icon={<Award className="w-4 h-4 text-primary" />}>
        <div className="flex items-center gap-3 mb-3">
          <div className="text-3xl">{r.badge_icon || "🏅"}</div>
          <div>
            <p className="text-lg font-semibold">{r.current || "Distributor"}</p>
            <p className="text-xs text-muted-foreground">{r.next ? `Next rank: ${r.next}` : "You've reached the top rank"}</p>
          </div>
        </div>
        <ProgressBar value={r.progress_pct} showLabel />
        <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
          <div className="rounded-lg border border-border p-2.5">
            <p className="text-muted-foreground">Trailing 90-day BV</p>
            <p className="font-medium text-sm">{fmtInr(r.trailing_90d_bv)}</p>
          </div>
          {r.next ? (
            <div className="rounded-lg border border-border p-2.5">
              <p className="text-muted-foreground">BV needed for {r.next}</p>
              <p className="font-medium text-sm">{fmtInr(r.bv_needed_for_next)}</p>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
