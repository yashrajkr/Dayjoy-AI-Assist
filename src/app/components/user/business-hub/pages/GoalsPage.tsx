import { useCallback, useEffect, useState } from "react";
import { Target, Plus, Trash2, CheckCircle2 } from "lucide-react";
import {
  distributorListGoals, distributorCreateGoal, distributorUpdateGoal, distributorDeleteGoal,
} from "../../../../../lib/api";
import { LoadingState, ErrorState, EmptyState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";

type Goal = {
  id: string;
  goal_type: string;
  category: string;
  target_value: number;
  current_value: number;
  period_start: string;
  period_end: string;
  is_achieved: boolean;
};

export function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ goal_type: "monthly", category: "sales", target_value: "", period_start: "", period_end: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGoals((await distributorListGoals()) as unknown as Goal[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addGoal = async () => {
    if (!form.target_value || !form.period_start || !form.period_end) return;
    setSaving(true);
    try {
      await distributorCreateGoal({
        goal_type: form.goal_type,
        category: form.category,
        target_value: Number(form.target_value),
        period_start: form.period_start,
        period_end: form.period_end,
      });
      setShowForm(false);
      setForm({ goal_type: "monthly", category: "sales", target_value: "", period_start: "", period_end: "" });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const markAchieved = async (id: string) => {
    await distributorUpdateGoal(id, { is_achieved: true });
    await load();
  };

  const remove = async (id: string) => {
    await distributorDeleteGoal(id);
    await load();
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your goals…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> Goals</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="w-4 h-4 mr-1" /> New Goal</Button>
      </div>

      <AiMiniCard
        title="AI Weekly Action Plan"
        prompts={["Create a weekly action plan to hit my goals.", "Which of my goals is most at risk?"]}
      />

      {showForm ? (
        <Section title="New Goal" icon={<Plus className="w-4 h-4 text-primary" />}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <select value={form.goal_type} onChange={(e) => setForm((f) => ({ ...f, goal_type: e.target.value }))} className="h-9 px-2 rounded-lg border border-border bg-background text-sm">
              {["daily", "weekly", "monthly", "quarterly", "yearly"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-9 px-2 rounded-lg border border-border bg-background text-sm">
              {["sales", "recruitment", "follow_ups", "training", "calls", "meetings", "customers"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" placeholder="Target value" value={form.target_value} onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))} className="h-9 px-2 rounded-lg border border-border bg-background text-sm" />
            <input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} className="h-9 px-2 rounded-lg border border-border bg-background text-sm" />
            <input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} className="h-9 px-2 rounded-lg border border-border bg-background text-sm" />
          </div>
          <Button size="sm" className="mt-3" disabled={saving} onClick={addGoal}>{saving ? "Saving…" : "Save Goal"}</Button>
        </Section>
      ) : null}

      {goals.length === 0 ? (
        <EmptyState title="No goals yet. Set a target and Dayjoy AI will track your progress automatically." />
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize truncate">{g.category} · {g.goal_type}</p>
                <p className="text-xs text-muted-foreground">{g.current_value}/{g.target_value} · {g.period_start} → {g.period_end}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {g.is_achieved ? (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-success/10 text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Achieved</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => markAchieved(g.id)}>Mark done</Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove(g.id)} aria-label="Delete goal"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
