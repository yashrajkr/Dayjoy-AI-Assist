import { useCallback, useEffect, useState } from "react";
import { Wallet, Clock, CheckCircle2, Ban } from "lucide-react";
import { biCommissions } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { Section, KpiCard, fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function IncomePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof biCommissions>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await biCommissions(90));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load income");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your income…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> Income</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="This Month" value={fmtInr(data.this_month_total)} icon={<Wallet className="w-4 h-4" />} />
        <KpiCard label="Pending" value={fmtInr(data.total_pending)} icon={<Clock className="w-4 h-4" />} />
        <KpiCard label="Paid" value={fmtInr(data.total_paid)} icon={<CheckCircle2 className="w-4 h-4" />} />
        <KpiCard label="Reversed" value={fmtInr(data.total_reversed)} icon={<Ban className="w-4 h-4" />} />
      </div>

      <AiMiniCard
        title="AI Income Predictor"
        prompts={["Predict my next commission payout.", "Why is my income up or down this month?", "How can I increase my earnings?"]}
      />

      <Section title="Recent Commission Activity" icon={<Wallet className="w-4 h-4 text-primary" />}>
        {data.commissions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No commissions recorded yet — they post automatically when your team's sales generate BV.</p>
        ) : (
          <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {data.commissions.slice(0, 30).map((c, i) => (
              <li key={i} className="flex items-center justify-between text-xs px-2.5 py-2 rounded-lg hover:bg-accent/30">
                <span className="text-muted-foreground">Level {String(c.level)} · {new Date(String(c.created_at)).toLocaleDateString()}</span>
                <span className="capitalize text-[10px] px-1.5 py-0.5 rounded-full border border-border">{String(c.status)}</span>
                <span className="font-medium">{fmtInr(Number(c.amount || 0))}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
