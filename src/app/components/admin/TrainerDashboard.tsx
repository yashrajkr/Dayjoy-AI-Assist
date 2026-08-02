import { useCallback, useEffect, useState } from "react";
import { GraduationCap, BookOpen, CheckCircle2, Users } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  StatCard,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusPill,
} from "../common/AdminUI";
import { Button } from "../ui/button";

type Training = {
  id: string;
  title: string | null;
  approval_status: string | null;
  created_at: string | null;
};

/**
 * Trainer Dashboard — for content creators and trainers.
 *
 * Shows: total modules, approved modules, pending modules, recent trainees.
 */
export function TrainerDashboard() {
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [recent, setRecent] = useState<Training[]>([]);
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
      const [total, approved, pending, recentData] = await Promise.all([
        supabase.from("distributor_training").select("*", { count: "exact", head: true }),
        supabase.from("distributor_training").select("*", { count: "exact", head: true }).eq("approval_status", "approved"),
        supabase.from("distributor_training").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
        supabase.from("distributor_training").select("id,title,approval_status,created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      setStats({
        total: total.count ?? 0,
        approved: approved.count ?? 0,
        pending: pending.count ?? 0,
      });
      setRecent((recentData.data ?? []) as Training[]);
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
        title="Trainer Dashboard"
        description="Manage training modules, track completion, and certify distributors."
        icon={<GraduationCap className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Total modules" value={stats.total} icon={<BookOpen className="w-5 h-5" />} />
            <StatCard label="Approved" value={stats.approved} icon={<CheckCircle2 className="w-5 h-5" />} />
            <StatCard label="Pending review" value={stats.pending} icon={<Users className="w-5 h-5" />} />
          </div>

          <Card>
            <h2 className="text-sm font-semibold mb-3">Recent modules</h2>
            {recent.length === 0 ? (
              <EmptyState
                title="No training modules yet"
                description="Create your first module in the Training Manager."
                icon={<GraduationCap className="w-5 h-5" />}
              />
            ) : (
              <ul className="space-y-2">
                {recent.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-accent/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.title || "Untitled"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}
                      </p>
                    </div>
                    {t.approval_status ? <StatusPill status={t.approval_status} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <h2 className="text-sm font-semibold mb-2">Trainer actions</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href="/admin/training">Add module</a>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href="/admin/approvals">Approve content</a>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href="/admin/users">View trainees</a>
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
