import { useCallback, useEffect, useState } from "react";
import { Target, Plus, Trash2, Check, Loader2, Save, X, Bell, Activity, TrendingUp } from "lucide-react";
import { Modal, modalButtonClass } from "../common/Modal";
import { LoadingState, ErrorState, EmptyState, btnClass } from "../common/AdminUI";
import { LineChart, ProgressBar, type LineChartPoint } from "../common/Charts";
import {
  customerListWellnessGoals, customerCreateWellnessGoal, customerUpdateWellnessGoal, customerDeleteWellnessGoal,
  customerListWellnessActivities, customerLogWellnessActivity,
  customerListReminders, customerCreateReminder, customerDeleteReminder,
  type WellnessGoal, type WellnessActivity, type Reminder,
} from "../../../lib/api";

const GOAL_TYPES = [
  { value: "general", label: "General Wellness", icon: "🌿" },
  { value: "weight", label: "Weight Management", icon: "⚖️" },
  { value: "energy", label: "Energy & Vitality", icon: "⚡" },
  { value: "immunity", label: "Immunity", icon: "🛡️" },
  { value: "sleep", label: "Sleep Quality", icon: "😴" },
  { value: "fitness", label: "Fitness", icon: "💪" },
  { value: "stress", label: "Stress Relief", icon: "🧘" },
  { value: "digestion", label: "Digestion", icon: "🍵" },
  { value: "skin", label: "Skin Health", icon: "✨" },
];

const REMINDER_TYPES = [
  { value: "product", label: "Product Usage" },
  { value: "medication", label: "Medication" },
  { value: "activity", label: "Activity" },
  { value: "water", label: "Water Intake" },
  { value: "measurement", label: "Measurement" },
  { value: "custom", label: "Custom" },
];

type Tab = "goals" | "activities" | "reminders";

export function WellnessJourney() {
  const [tab, setTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<WellnessGoal[]>([]);
  const [activities, setActivities] = useState<WellnessActivity[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Goal modal
  const [goalModal, setGoalModal] = useState(false);
  const [goalForm, setGoalForm] = useState({ goal_type: "general", title: "", target_value: "", unit: "", target_date: "" });
  const [savingGoal, setSavingGoal] = useState(false);

  // Activity modal
  const [actModal, setActModal] = useState(false);
  const [actForm, setActForm] = useState({ activity_type: "custom", title: "", value: "", unit: "", duration_minutes: "", notes: "" });
  const [savingAct, setSavingAct] = useState(false);

  // Reminder modal
  const [remModal, setRemModal] = useState(false);
  const [remForm, setRemForm] = useState({ reminder_type: "product", title: "", time_of_day: "09:00", frequency: "daily" });
  const [savingRem, setSavingRem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, a, r] = await Promise.all([
        customerListWellnessGoals(),
        customerListWellnessActivities(30),
        customerListReminders(true),
      ]);
      setGoals(g); setActivities(a); setReminders(r);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveGoal = async () => {
    if (!goalForm.title.trim()) return;
    setSavingGoal(true);
    try {
      await customerCreateWellnessGoal({
        goal_type: goalForm.goal_type, title: goalForm.title,
        target_value: goalForm.target_value ? parseFloat(goalForm.target_value) : null,
        unit: goalForm.unit, target_date: goalForm.target_date || null,
      });
      setGoalModal(false); setGoalForm({ goal_type: "general", title: "", target_value: "", unit: "", target_date: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSavingGoal(false); }
  };

  const updateGoalProgress = async (g: WellnessGoal, delta: number) => {
    if (!g.id) return;
    const newVal = Math.max(0, Number(g.current_value || 0) + delta);
    await customerUpdateWellnessGoal(g.id, { current_value: newVal, is_completed: Boolean(g.target_value && newVal >= Number(g.target_value)) });
    await load();
  };

  const completeGoal = async (g: WellnessGoal) => {
    if (!g.id) return;
    await customerUpdateWellnessGoal(g.id, { is_completed: true });
    await load();
  };

  const deleteGoal = async (g: WellnessGoal) => {
    if (!g.id || !window.confirm("Delete this goal?")) return;
    await customerDeleteWellnessGoal(g.id); await load();
  };

  const saveActivity = async () => {
    if (!actForm.title.trim()) return;
    setSavingAct(true);
    try {
      await customerLogWellnessActivity({
        activity_type: actForm.activity_type, title: actForm.title,
        value: actForm.value ? parseFloat(actForm.value) : null,
        unit: actForm.unit || null,
        duration_minutes: actForm.duration_minutes ? parseInt(actForm.duration_minutes) : null,
        notes: actForm.notes || null,
      });
      setActModal(false); setActForm({ activity_type: "custom", title: "", value: "", unit: "", duration_minutes: "", notes: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSavingAct(false); }
  };

  const saveReminder = async () => {
    if (!remForm.title.trim()) return;
    setSavingRem(true);
    try {
      await customerCreateReminder({
        reminder_type: remForm.reminder_type, title: remForm.title,
        time_of_day: remForm.time_of_day, frequency: remForm.frequency,
      });
      setRemModal(false); setRemForm({ reminder_type: "product", title: "", time_of_day: "09:00", frequency: "daily" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSavingRem(false); }
  };

  const deleteReminder = async (r: Reminder) => {
    if (!r.id || !window.confirm("Delete this reminder?")) return;
    await customerDeleteReminder(r.id); await load();
  };

  // Activity trend chart
  const trendData: LineChartPoint[] = activities.slice(0, 14).reverse().map((a) => ({
    label: a.activity_date ? String(a.activity_date).slice(5) : "",
    value: Number(a.value || a.duration_minutes || 1),
  }));

  const tabs: { value: Tab; label: string; icon: typeof Target; count?: number }[] = [
    { value: "goals", label: "Goals", icon: Target, count: goals.filter((g) => !g.is_completed).length },
    { value: "activities", label: "Activities", icon: Activity, count: activities.length },
    { value: "reminders", label: "Reminders", icon: Bell, count: reminders.length },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> Wellness Journey</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Set goals, track activities, and manage reminders.</p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold text-primary">{goals.filter((g) => !g.is_completed).length}</p><p className="text-[10px] text-muted-foreground">Active Goals</p></div>
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">{goals.filter((g) => g.is_completed).length}</p><p className="text-[10px] text-muted-foreground">Completed</p></div>
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">{reminders.length}</p><p className="text-[10px] text-muted-foreground">Reminders</p></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
            {t.count != null && t.count > 0 ? <span className="text-[10px] bg-accent px-1.5 py-0.5 rounded-full">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : null}

      {/* Goals tab */}
      {tab === "goals" && !loading ? (
        <>
          <button type="button" className={`${btnClass.primary} mb-3`} onClick={() => setGoalModal(true)}><Plus className="w-4 h-4" /> Add Goal</button>
          {goals.length === 0 ? <div className="rounded-2xl border border-border bg-card"><EmptyState title="No goals yet" description="Set your first wellness goal to start your journey." icon={<Target className="w-5 h-5" />} /></div> : (
            <div className="space-y-2">
              {goals.map((g) => {
                const target = Number(g.target_value || 0);
                const current = Number(g.current_value || 0);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const goalType = GOAL_TYPES.find((t) => t.value === g.goal_type);
                return (
                  <div key={g.id} className={`rounded-xl border bg-card p-3 ${g.is_completed ? "border-primary/30 bg-primary/5" : "border-border"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{goalType?.icon || "🎯"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.title}</p>
                        <p className="text-[10px] text-muted-foreground">{goalType?.label || "Goal"} · {current}/{target} {g.unit || ""}</p>
                      </div>
                      {g.is_completed ? <Check className="w-4 h-4 text-primary" /> : null}
                      <button type="button" onClick={() => deleteGoal(g)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    {!g.is_completed && target > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><ProgressBar value={pct} showLabel /></div>
                        {target > 0 ? (
                          <>
                            <button type="button" onClick={() => updateGoalProgress(g, -1)} className="text-xs w-6 h-6 rounded border border-border hover:bg-accent">−</button>
                            <button type="button" onClick={() => updateGoalProgress(g, 1)} className="text-xs w-6 h-6 rounded border border-border hover:bg-accent">+</button>
                            <button type="button" onClick={() => completeGoal(g)} className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10">Done</button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {/* Activities tab */}
      {tab === "activities" && !loading ? (
        <>
          <button type="button" className={`${btnClass.primary} mb-3`} onClick={() => setActModal(true)}><Plus className="w-4 h-4" /> Log Activity</button>
          {trendData.length > 0 ? (
            <div className="rounded-2xl border border-border bg-card p-4 mb-3">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Activity Trend</h3>
              <LineChart data={trendData} height={160} />
            </div>
          ) : null}
          {activities.length === 0 ? <div className="rounded-2xl border border-border bg-card"><EmptyState title="No activities logged" icon={<Activity className="w-5 h-5" />} /></div> : (
            <div className="space-y-1.5">
              {activities.map((a) => (
                <div key={a.id} className="rounded-lg border border-border bg-card p-2 flex items-center gap-2 text-xs">
                  <Activity className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.title}</p>
                    <p className="text-[10px] text-muted-foreground">{a.activity_date} · {a.value ? `${a.value} ${a.unit || ""}` : ""}{a.duration_minutes ? ` · ${a.duration_minutes}min` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Reminders tab */}
      {tab === "reminders" && !loading ? (
        <>
          <button type="button" className={`${btnClass.primary} mb-3`} onClick={() => setRemModal(true)}><Plus className="w-4 h-4" /> Add Reminder</button>
          {reminders.length === 0 ? <div className="rounded-2xl border border-border bg-card"><EmptyState title="No reminders" description="Set reminders for product usage, medications, or activities." icon={<Bell className="w-5 h-5" />} /></div> : (
            <div className="space-y-2">
              {reminders.map((r) => (
                <div key={r.id} className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{r.reminder_type} · {r.frequency} · {r.time_of_day}</p>
                  </div>
                  <button type="button" onClick={() => deleteReminder(r)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Goal modal */}
      <Modal open={goalModal} onClose={() => setGoalModal(false)} title="New Wellness Goal" size="md"
        footer={<><button type="button" className={modalButtonClass.secondary} onClick={() => setGoalModal(false)}><X className="w-4 h-4" /> Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={saveGoal} disabled={savingGoal}>{savingGoal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create</button></>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Goal Type</label>
            <div className="grid grid-cols-3 gap-1.5">
              {GOAL_TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => setGoalForm({ ...goalForm, goal_type: t.value })}
                  className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border text-xs ${goalForm.goal_type === t.value ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="text-lg">{t.icon}</span>{t.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
            <input type="text" value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
              placeholder="e.g. Drink 3L water daily" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Target</label><input type="number" value={goalForm.target_value} onChange={(e) => setGoalForm({ ...goalForm, target_value: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Unit</label><input type="text" value={goalForm.unit} onChange={(e) => setGoalForm({ ...goalForm, unit: e.target.value })} placeholder="L, kg, min" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Target Date</label><input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
          </div>
        </div>
      </Modal>

      {/* Activity modal */}
      <Modal open={actModal} onClose={() => setActModal(false)} title="Log Activity" size="sm"
        footer={<><button type="button" className={modalButtonClass.secondary} onClick={() => setActModal(false)}>Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={saveActivity} disabled={savingAct}>{savingAct ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Log</button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Type</label>
            <select value={actForm.activity_type} onChange={(e) => setActForm({ ...actForm, activity_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {["custom","lesson","quiz","workout","meditation","water_intake","sleep_log","meal_log","supplement","measurement"].map((t) => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input type="text" value={actForm.title} onChange={(e) => setActForm({ ...actForm, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs text-muted-foreground mb-1">Value</label><input type="number" value={actForm.value} onChange={(e) => setActForm({ ...actForm, value: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">Duration (min)</label><input type="number" value={actForm.duration_minutes} onChange={(e) => setActForm({ ...actForm, duration_minutes: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
          </div>
        </div>
      </Modal>

      {/* Reminder modal */}
      <Modal open={remModal} onClose={() => setRemModal(false)} title="New Reminder" size="sm"
        footer={<><button type="button" className={modalButtonClass.secondary} onClick={() => setRemModal(false)}>Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={saveReminder} disabled={savingRem}>{savingRem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create</button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Type</label>
            <select value={remForm.reminder_type} onChange={(e) => setRemForm({ ...remForm, reminder_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {REMINDER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input type="text" value={remForm.title} onChange={(e) => setRemForm({ ...remForm, title: e.target.value })} placeholder="e.g. Take Ashwagandha" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs text-muted-foreground mb-1">Time</label><input type="time" value={remForm.time_of_day} onChange={(e) => setRemForm({ ...remForm, time_of_day: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">Frequency</label><select value={remForm.frequency} onChange={(e) => setRemForm({ ...remForm, frequency: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
