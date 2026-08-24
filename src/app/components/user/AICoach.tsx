import { useCallback, useEffect, useState } from "react";
import { Target, Loader2, Plus, Check, CheckCircle2, Archive } from "lucide-react";
import { AppHeader } from "../common/AppHeader";
import { EmptyState, ErrorState, LoadingState } from "../common/AdminUI";
import {
  createCoachGoal, listCoachGoals, updateCoachGoal, completeCoachTask, reopenCoachTask,
  type CoachGoal,
} from "../../../lib/api";

/** Persistent AI Coach — Goal -> Plan -> Execute (Next-Gen spec, Phases 5,
 * 13). Follows SavedWork.tsx's established shape: loading skeleton ->
 * error state (with retry) -> empty state -> data view. */
export function AICoach() {
  const [goals, setGoals] = useState<CoachGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newGoalText, setNewGoalText] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCoachGoals();
      setGoals(res.goals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your goals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateGoal = useCallback(async () => {
    const text = newGoalText.trim();
    if (!text) return;
    setCreating(true);
    try {
      const goal = await createCoachGoal(text);
      setGoals((prev) => [goal, ...prev]);
      setNewGoalText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that goal.");
    } finally {
      setCreating(false);
    }
  }, [newGoalText]);

  const handleToggleTask = useCallback(async (goalId: string, taskId: string, currentlyDone: boolean) => {
    // Optimistic update — matches SavedWork's InteractiveChecklist pattern.
    setGoals((prev) =>
      prev.map((g) =>
        g.id !== goalId
          ? g
          : { ...g, tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, status: currentlyDone ? "pending" : "done" } : t)) },
      ),
    );
    try {
      if (currentlyDone) await reopenCoachTask(taskId);
      else await completeCoachTask(taskId);
    } catch {
      // Best-effort — a failed toggle self-corrects on the next reload;
      // the optimistic state stands in the meantime rather than jarring
      // the user with an immediate revert.
    }
  }, []);

  const handleMarkGoalStatus = useCallback(async (goalId: string, status: "completed" | "abandoned") => {
    try {
      await updateCoachGoal(goalId, { status });
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that goal.");
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="AI Coach"
        subtitle="Set a goal, get a concrete plan, and track your progress — pick up where you left off any time."
        icon={Target}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newGoalText}
              onChange={(e) => setNewGoalText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) handleCreateGoal();
              }}
              placeholder="What do you want to work on? e.g. Improve my customer follow-up"
              maxLength={500}
              disabled={creating}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              aria-label="New goal"
            />
            <button
              type="button"
              onClick={handleCreateGoal}
              disabled={creating || !newGoalText.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 shrink-0"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
              Set goal
            </button>
          </div>

          {loading ? (
            <LoadingState label="Loading your goals…" />
          ) : error ? (
            <ErrorState message={error} />
          ) : goals.length === 0 ? (
            <EmptyState
              icon={<Target className="w-8 h-8" aria-hidden="true" />}
              title="No active goals yet"
              description="Set a goal above and DayJoy AI will build you a concrete plan to work through, a few small steps at a time."
            />
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => {
                const doneCount = goal.tasks.filter((t) => t.status === "done").length;
                return (
                  <div key={goal.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-medium text-sm">{goal.goal_text}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {doneCount} of {goal.tasks.length} steps done
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMarkGoalStatus(goal.id, "completed")}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-emerald-600"
                          title="Mark goal as completed"
                          aria-label="Mark goal as completed"
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarkGoalStatus(goal.id, "abandoned")}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent/60"
                          title="Archive this goal"
                          aria-label="Archive this goal"
                        >
                          <Archive className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {goal.tasks.map((task) => {
                        const done = task.status === "done";
                        return (
                          <li key={task.id} className="flex items-start gap-2.5">
                            <button
                              type="button"
                              onClick={() => handleToggleTask(goal.id, task.id, done)}
                              className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                                done ? "bg-primary border-primary text-primary-foreground" : "border-border"
                              }`}
                              aria-label={done ? `Mark "${task.task_text}" as not done` : `Mark "${task.task_text}" as done`}
                              aria-pressed={done}
                            >
                              {done ? <Check className="w-3 h-3" aria-hidden="true" /> : null}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>{task.task_text}</p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{task.day_label}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
