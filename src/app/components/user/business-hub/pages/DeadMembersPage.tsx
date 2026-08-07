import { useCallback, useEffect, useState } from "react";
import { UserX } from "lucide-react";
import { biTeamAnalytics } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

export function DeadMembersPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof biTeamAnalytics>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await biTeamAnalytics());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Checking team activity…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!data) return null;

  const dead = [...data.inactive_leaders, ...data.needs_support];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><UserX className="w-5 h-5 text-primary" /> Dead Members</h1>
      <p className="text-xs text-muted-foreground">
        Team members flagged inactive (30+ days no activity) or showing zero sales with incomplete training —
        {" "}{dead.length} of {data.team_size} total.
      </p>

      <AiMiniCard
        title="AI Reactivation Coach"
        prompts={["How should I reach out to reactivate inactive members?", "Which inactive member is worth reactivating first?"]}
      />

      <Section title="Needs Attention" icon={<UserX className="w-4 h-4 text-primary" />}>
        {dead.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Your whole team is active — nobody needs reactivation right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {dead.map((m, i) => (
              <li key={i} className="flex items-center justify-between text-sm px-3 py-2.5 rounded-lg border border-border">
                <span className="truncate">{String(m.member_name || "—")}</span>
                <span className="text-[10px] text-warning px-2 py-0.5 rounded-full border border-warning/40">
                  {m.last_active_at ? `Inactive since ${new Date(String(m.last_active_at)).toLocaleDateString()}` : "No recorded activity"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
