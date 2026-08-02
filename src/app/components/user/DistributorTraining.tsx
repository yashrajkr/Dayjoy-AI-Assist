import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Award, TrendingUp, Trophy, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader,
  StatCard,
  EmptyState,
  LoadingState,
  ErrorState,
  StatusPill,
} from "../common/AdminUI";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

type Training = {
  id: string;
  title: string | null;
  content: string | null;
  approval_status: string | null;
};

type Progress = {
  id?: string;
  training_id: string;
  status: "not_started" | "in_progress" | "completed";
  progress_percent: number;
  completed_at: string | null;
};

/**
 * DistributorTraining — AI Training Mode for distributors.
 *
 * Modules: Products, Sales, Compliance, Policies, Customer Handling,
 * Objection Handling, Knowledge Tests, Progress Tracking, Certificates,
 * Completion Status, Leaderboard.
 *
 * Reads approved training modules from `distributor_training` table and
 * per-user progress from `training_progress` table (both created in
 * supabase_schema_v2.sql). Certificates are auto-generated when a module
 * hits 100% completion.
 */
const MODULE_CATEGORIES = [
  "Products",
  "Sales",
  "Compliance",
  "Policies",
  "Customer Handling",
  "Objection Handling",
  "Knowledge Tests",
] as const;

export function DistributorTraining() {
  const { currentUser } = useAuth();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [leaderboard, setLeaderboard] = useState<Array<{ user_id: string; completed: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const [tr, pr] = await Promise.all([
        supabase
          .from("distributor_training")
          .select("id,title,content,approval_status")
          .eq("approval_status", "approved")
          .order("created_at", { ascending: true }),
        currentUser?.id
          ? supabase.from("training_progress").select("id,training_id,status,progress_percent,completed_at").eq("user_id", currentUser.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (tr.error) throw tr.error;
      setTrainings((tr.data ?? []) as Training[]);
      const progressMap: Record<string, Progress> = {};
      for (const p of (pr.data ?? []) as Progress[]) {
        progressMap[p.training_id] = p;
      }
      setProgress(progressMap);

      // Leaderboard — top 5 users by completed module count
      const { data: lb } = await supabase
        .from("training_progress")
        .select("user_id")
        .eq("status", "completed");
      const counts: Record<string, number> = {};
      for (const row of (lb ?? []) as { user_id: string }[]) {
        counts[row.user_id] = (counts[row.user_id] ?? 0) + 1;
      }
      setLeaderboard(
        Object.entries(counts)
          .map(([user_id, completed]) => ({ user_id, completed }))
          .sort((a, b) => b.completed - a.completed)
          .slice(0, 5),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load training");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const markProgress = async (trainingId: string, percent: number) => {
    if (!supabase || !currentUser?.id) return;
    const existing = progress[trainingId];
    const nextStatus: Progress["status"] = percent >= 100 ? "completed" : percent > 0 ? "in_progress" : "not_started";
    try {
      if (existing?.id) {
        await supabase
          .from("training_progress")
          .update({
            progress_percent: percent,
            status: nextStatus,
            completed_at: percent >= 100 ? new Date().toISOString() : null,
          })
          .eq("id", existing.id);
      } else {
        const { data } = await supabase
          .from("training_progress")
          .insert({
            user_id: currentUser.id,
            training_id: trainingId,
            progress_percent: percent,
            status: nextStatus,
            completed_at: percent >= 100 ? new Date().toISOString() : null,
          })
          .select("id")
          .single();
        if (data) {
          setProgress((prev) => ({
            ...prev,
            [trainingId]: { ...existing, id: data.id, training_id: trainingId, progress_percent: percent, status: nextStatus, completed_at: percent >= 100 ? new Date().toISOString() : null },
          }));
        }
      }
      setProgress((prev) => ({
        ...prev,
        [trainingId]: {
          ...prev[trainingId],
          training_id: trainingId,
          progress_percent: percent,
          status: nextStatus,
          completed_at: percent >= 100 ? new Date().toISOString() : null,
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update progress");
    }
  };

  const completedCount = Object.values(progress).filter((p) => p.status === "completed").length;
  const inProgressCount = Object.values(progress).filter((p) => p.status === "in_progress").length;
  const avgProgress =
    trainings.length === 0
      ? 0
      : Math.round(
          trainings.reduce((s, t) => s + (progress[t.id]?.progress_percent ?? 0), 0) / trainings.length,
        );

  const filteredTrainings = activeCategory
    ? trainings.filter((t) => t.title?.toLowerCase().includes(activeCategory.toLowerCase()))
    : trainings;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Distributor Training"
        description="Complete modules to earn certificates and climb the leaderboard."
        icon={<GraduationCap className="w-5 h-5" />}
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading training…" />
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Completed" value={completedCount} icon={<CheckCircle2 className="w-5 h-5" />} />
            <StatCard label="In progress" value={inProgressCount} icon={<Clock className="w-5 h-5" />} />
            <StatCard label="Avg progress" value={`${avgProgress}%`} icon={<TrendingUp className="w-5 h-5" />} />
            <StatCard label="Certificates" value={completedCount} icon={<Award className="w-5 h-5" />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            {/* Modules */}
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setActiveCategory("")}
                  className={`px-3 py-1.5 rounded-full text-xs ${
                    activeCategory === "" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                  }`}
                >
                  All
                </button>
                {MODULE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs ${
                      activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {filteredTrainings.length === 0 ? (
                <Card className="p-5 shadow-none">
                  <EmptyState
                    title="No training modules"
                    description="Check back soon — new modules are being added."
                    icon={<GraduationCap className="w-5 h-5" />}
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredTrainings.map((t) => {
                    const p = progress[t.id];
                    const pct = p?.progress_percent ?? 0;
                    const isComplete = p?.status === "completed";
                    return (
                      <Card key={t.id} className="p-5 shadow-none">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium">{t.title || "Untitled module"}</h3>
                            {p?.status ? <StatusPill status={p.status} /> : null}
                          </div>
                          {isComplete ? (
                            <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                              <Award className="w-3.5 h-3.5" aria-hidden="true" /> Certified
                            </span>
                          ) : null}
                        </div>
                        {t.content ? (
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{t.content}</p>
                        ) : null}
                        {/* Progress bar */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                        </div>
                        <div className="flex gap-2">
                          {pct === 0 ? (
                            <Button type="button" onClick={() => markProgress(t.id, 25)}>
                              Start
                            </Button>
                          ) : pct < 100 ? (
                            <Button type="button" onClick={() => markProgress(t.id, Math.min(100, pct + 25))}>
                              Continue
                            </Button>
                          ) : (
                            <Button type="button" variant="secondary" onClick={() => markProgress(t.id, 0)}>
                              Reset
                            </Button>
                          )}
                          {isComplete ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => window.print()}
                            >
                              <Award className="w-3.5 h-3.5" aria-hidden="true" /> Print certificate
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Leaderboard */}
            <aside>
              <Card className="p-5 shadow-none">
                <div className="flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-gold-accent" aria-hidden="true" />
                  <h2 className="text-sm font-semibold">Leaderboard</h2>
                </div>
                {leaderboard.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No completions yet. Be the first!
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {leaderboard.map((entry, i) => (
                      <li
                        key={entry.user_id}
                        className={`flex items-center gap-2 p-2 rounded-lg ${
                          i === 0 ? "bg-gold-accent/10" : "hover:bg-accent/30"
                        }`}
                      >
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            i === 0
                              ? "bg-gold-accent text-primary-foreground"
                              : i === 1
                                ? "bg-muted text-muted-foreground"
                                : i === 2
                                  ? "bg-warning/20 text-warning"
                                  : "bg-accent text-accent-foreground"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="flex-1 text-xs font-mono truncate">
                          {entry.user_id.slice(0, 8)}…
                        </span>
                        <span className="text-xs font-medium">{entry.completed}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
