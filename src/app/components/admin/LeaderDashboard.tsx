import { useCallback, useEffect, useState } from "react";
import { TrendingUp, Users, Award, Target } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader,
  Card,
  StatCard,
  LoadingState,
  ErrorState,
} from "../common/AdminUI";

/**
 * Leader Dashboard — for sales team leaders.
 *
 * Shows: team size, team chat volume, top performer, team training completion.
 * All metrics read from Supabase with RLS enforcing that leaders only see
 * their downstream team (RLS policy assumes a `leader_id` column on profiles
 * in a future migration — for now we show aggregate counts the leader can
 * access via existing policies).
 */
export function LeaderDashboard() {
  const { currentUser } = useAuth();
  const [stats, setStats] = useState({
    teamSize: 0,
    teamChats: 0,
    avgTraining: 0,
    topPerformer: "—",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      // Team size = distributors in the system (simplified; real impl would
      // filter by leader_id once that column exists).
      const [distributors, chats, progress] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "distributor"),
        supabase.from("chat_conversations").select("*", { count: "exact", head: true }),
        supabase.from("training_progress").select("progress_percent").eq("status", "completed"),
      ]);
      const avg =
        progress.data && progress.data.length > 0
          ? Math.round(
              progress.data.reduce((s: number, p: { progress_percent?: number }) => s + (p.progress_percent ?? 0), 0) /
                progress.data.length,
            )
          : 0;
      setStats({
        teamSize: distributors.count ?? 0,
        teamChats: chats.count ?? 0,
        avgTraining: avg,
        topPerformer: "—",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Leader Dashboard"
        description="Track your team's performance, training progress, and engagement."
        icon={<TrendingUp className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Team size" value={stats.teamSize} icon={<Users className="w-5 h-5" />} />
            <StatCard label="Team chats" value={stats.teamChats} icon={<Target className="w-5 h-5" />} />
            <StatCard label="Avg training" value={`${stats.avgTraining}%`} icon={<Award className="w-5 h-5" />} />
            <StatCard label="Top performer" value={stats.topPerformer} />
          </div>

          <Card>
            <h2 className="text-sm font-semibold mb-2">Leader actions</h2>
            <div className="flex flex-wrap gap-2">
              <a href="/admin/training" className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent/60">View training</a>
              <a href="/admin/leads" className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent/60">Review leads</a>
              <a href="/admin/analytics" className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent/60">Team analytics</a>
              <a href="/distributor" className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent/60">Distributor tools</a>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
