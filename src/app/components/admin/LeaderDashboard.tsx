import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Users, Award, Trophy, Wallet, Crown } from "lucide-react";
import { distributorTeamOverview, type TeamMember } from "../../../lib/api";
import {
  PageHeader,
  Card,
  StatCard,
  LoadingState,
  ErrorState,
  EmptyState,
} from "../common/AdminUI";
import { Button } from "../ui/button";

type TeamOverview = Awaited<ReturnType<typeof distributorTeamOverview>>;

/**
 * Leader Dashboard — for distributors managing a larger downline.
 *
 * Reuses the same `/distributor/team` endpoint the Business Hub's Team page
 * calls (RLS-scoped to `leader_id = auth.uid()`), so a Leader account sees
 * its own downline and real sales/training numbers instead of an
 * unrelated system-wide count.
 */
export function LeaderDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await distributorTeamOverview();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Leader Dashboard"
          description="Track your downline's performance, training progress, and engagement."
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <LoadingState label="Loading your team…" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Leader Dashboard"
          description="Track your downline's performance, training progress, and engagement."
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <ErrorState message={error ?? "Failed to load dashboard"} />
        <Button onClick={load} className="mt-3">Retry</Button>
      </div>
    );
  }

  const topPerformer: TeamMember | undefined = data.leaderboard[0];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Leader Dashboard"
        description="Track your downline's performance, training progress, and engagement."
        icon={<TrendingUp className="w-5 h-5" />}
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate("/distributor/dashboard/team")}>
            Open full Team workspace
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Downline size" value={data.active_count} icon={<Users className="w-5 h-5" />} />
        <StatCard label="Team sales" value={`₹${data.total_sales.toLocaleString()}`} icon={<Wallet className="w-5 h-5" />} />
        <StatCard label="Avg training" value={`${data.avg_training}%`} icon={<Award className="w-5 h-5" />} />
        <StatCard
          label="Top performer"
          value={topPerformer?.member_name ?? "—"}
          hint={topPerformer ? `${topPerformer.rank} · ₹${Number(topPerformer.total_sales || 0).toLocaleString()}` : undefined}
          icon={<Crown className="w-5 h-5" />}
        />
      </div>

      <Card className="p-4 mb-6 shadow-none">
        <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
          <Trophy className="w-4 h-4 text-amber-500" /> Team leaderboard
        </h2>
        {data.leaderboard.length === 0 ? (
          <EmptyState title="No downline yet" description="Distributors you recruit will appear here once they join your team." icon={<Users className="w-5 h-5" />} />
        ) : (
          <div className="space-y-1.5">
            {data.leaderboard.slice(0, 10).map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0
                      ? "bg-amber-100 text-amber-700"
                      : i === 1
                        ? "bg-slate-100 text-slate-700"
                        : i === 2
                          ? "bg-orange-100 text-orange-700"
                          : "bg-accent text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.member_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {m.rank} · Lvl {m.level} · {m.training_completion}% trained
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  ₹{Number(m.total_sales || 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-2">Leader actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate("/admin/training")}>
            View training
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate("/admin/leads")}>
            Review leads
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate("/distributor/dashboard/analytics")}>
            Team analytics
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate("/distributor/dashboard")}>
            Distributor tools
          </Button>
        </div>
      </Card>
    </div>
  );
}
