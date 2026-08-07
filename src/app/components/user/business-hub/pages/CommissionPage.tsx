import { useCallback, useEffect, useState } from "react";
import { Percent } from "lucide-react";
import { biCommissions } from "../../../../../lib/api";
import { LoadingState, ErrorState, EmptyState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { fmtInr } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function CommissionPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof biCommissions>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await biCommissions(365));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load commissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your commission ledger…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Percent className="w-5 h-5 text-primary" /> Commission Ledger</h1>
      <p className="text-xs text-muted-foreground">Full trailing-12-month commission history — {data.count} entries, sponsor-tree payouts computed from your team's business volume.</p>

      <AiMiniCard
        title="AI Commission Analyst"
        prompts={["Explain how my commission is calculated.", "Which team members generate the most commission for me?"]}
      />

      {data.commissions.length === 0 ? (
        <EmptyState title="No commission records yet. Commissions post automatically when your team's purchases generate business volume." />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-accent/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Level</th>
                  <th className="text-left px-3 py-2 font-medium">Rate</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.commissions.map((c, i) => (
                  <tr key={i} className="border-t border-border hover:bg-accent/20">
                    <td className="px-3 py-2">{new Date(String(c.created_at)).toLocaleDateString()}</td>
                    <td className="px-3 py-2">L{String(c.level)}</td>
                    <td className="px-3 py-2">{Math.round(Number(c.rate || 0) * 100)}%</td>
                    <td className="px-3 py-2 capitalize">{String(c.status)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtInr(Number(c.amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
