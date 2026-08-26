import { useCallback, useEffect, useState } from "react";
import { Target, Plus, Trash2, Check, Loader2, Save, X, Bell, Activity, TrendingUp, Minus, Search, BellRing, Sunrise, HeartPulse, Award, CalendarDays, Gauge } from "lucide-react";
import { Modal } from "../common/Modal";
import { LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { LineChart, ProgressBar, type LineChartPoint } from "../common/Charts";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { getProductsDiagnostic, type Product } from "../../lib/db";
import { getPushSubscriptionState, subscribeToPush, isNotificationSupported } from "../../lib/pushNotifications";
import {
  customerListWellnessGoals, customerCreateWellnessGoal, customerUpdateWellnessGoal, customerDeleteWellnessGoal,
  customerListWellnessActivities, customerLogWellnessActivity,
  customerListReminders, customerCreateReminder, customerDeleteReminder,
  customerGetTodayCheckin, customerUpsertCheckin,
  customerListWellnessPreferences, customerUpsertWellnessPreference, customerDeleteWellnessPreference,
  customerConfirmWellnessPreference,
  customerListWellnessMilestones, customerCreateWellnessMilestone, customerAddMilestoneReflection,
  type WellnessGoal, type WellnessActivity, type Reminder, type WellnessCheckin, type WellnessPreference,
  type WellnessMilestone, type WellnessMilestoneType,
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

/**
 * Per-goal-type guidance — before this, every goal type showed the exact
 * same bare "Target / Unit" boxes with zero hint what to put in either
 * (what does "Target: 12, Unit: (blank)" even mean for "Digestion"?).
 * `mode: "rating"` covers goal types with no natural physical unit
 * (energy/stress/digestion/skin/general) — these use a 1-10 daily rating
 * scale instead of a fabricated unit, the same pattern mood-tracker apps
 * (Daylio/Bearable) use. `mode: "quantity"` covers goal types that DO have
 * a real physical unit, offered as a locked choice of units instead of
 * free text so the value stored is always something the progress bar and
 * an activity log can actually agree on.
 */
const GOAL_TYPE_PRESETS: Record<
  string,
  {
    titlePlaceholder: string;
    targetLabel: string;
    targetHint: string;
    mode: "quantity" | "rating";
    units: string[];
    defaultUnit: string;
    defaultTarget: string;
  }
> = {
  general: { titlePlaceholder: "e.g. Feel more balanced day to day", targetLabel: "Daily wellbeing target", targetHint: "How you want to feel most days, out of 10", mode: "rating", units: ["/10"], defaultUnit: "/10", defaultTarget: "8" },
  weight: { titlePlaceholder: "e.g. Reach a healthy weight", targetLabel: "Target weight", targetHint: "Your goal weight", mode: "quantity", units: ["kg", "lbs"], defaultUnit: "kg", defaultTarget: "" },
  energy: { titlePlaceholder: "e.g. Feel more energetic every day", targetLabel: "Daily energy target", targetHint: "Your target energy level, out of 10", mode: "rating", units: ["/10"], defaultUnit: "/10", defaultTarget: "8" },
  immunity: { titlePlaceholder: "e.g. Stay well through the season", targetLabel: "Sick-free streak", targetHint: "Consecutive days without falling ill", mode: "quantity", units: ["days"], defaultUnit: "days", defaultTarget: "30" },
  sleep: { titlePlaceholder: "e.g. Get consistent, restful sleep", targetLabel: "Target sleep", targetHint: "Hours of sleep per night", mode: "quantity", units: ["hours"], defaultUnit: "hours", defaultTarget: "8" },
  fitness: { titlePlaceholder: "e.g. Work out regularly", targetLabel: "Weekly target", targetHint: "How many workouts per week", mode: "quantity", units: ["workouts/wk", "minutes/wk"], defaultUnit: "workouts/wk", defaultTarget: "3" },
  stress: { titlePlaceholder: "e.g. Feel calmer day to day", targetLabel: "Calm target", targetHint: "Your target calm level, out of 10", mode: "rating", units: ["/10"], defaultUnit: "/10", defaultTarget: "7" },
  digestion: { titlePlaceholder: "e.g. Improve digestive comfort", targetLabel: "Comfort target", targetHint: "Your target digestive comfort, out of 10", mode: "rating", units: ["/10"], defaultUnit: "/10", defaultTarget: "8" },
  skin: { titlePlaceholder: "e.g. Clearer, healthier skin", targetLabel: "Skin goal", targetHint: "Your target skin clarity, out of 10", mode: "rating", units: ["/10"], defaultUnit: "/10", defaultTarget: "8" },
};

/**
 * Per-activity-type field visibility + labeling — before this, every type
 * showed the same bare "Value" and "Duration (min)" boxes, so picking
 * "Water Intake" gave no clue whether Value meant glasses or ml, and still
 * showed an irrelevant Duration box. "lesson"/"quiz" (leftover
 * training-progress activity types, not meaningful for a personal wellness
 * log) are simply not offered as choices any more — the DB still allows
 * them, only this picker's option list changed.
 */
const ACTIVITY_TYPE_PRESETS: Record<
  string,
  {
    label: string;
    titlePlaceholder: string;
    showValue: boolean;
    showDuration: boolean;
    valueLabel?: string;
    valueUnit?: string;
    quickValues?: number[];
  }
> = {
  water_intake: { label: "Water Intake", titlePlaceholder: "Water intake", showValue: true, showDuration: false, valueLabel: "Glasses (250ml)", valueUnit: "glasses", quickValues: [1, 2, 4, 8] },
  sleep_log: { label: "Sleep", titlePlaceholder: "Last night's sleep", showValue: true, showDuration: false, valueLabel: "Hours slept", valueUnit: "hours" },
  workout: { label: "Workout", titlePlaceholder: "e.g. Morning walk, strength training", showValue: false, showDuration: true },
  meditation: { label: "Meditation", titlePlaceholder: "e.g. Breathing session", showValue: false, showDuration: true },
  meal_log: { label: "Meal", titlePlaceholder: "e.g. Balanced lunch with vegetables", showValue: false, showDuration: false },
  supplement: { label: "Supplement", titlePlaceholder: "e.g. Took Ashwagandha", showValue: false, showDuration: false },
  measurement: { label: "Measurement", titlePlaceholder: "e.g. Weight, waist size", showValue: true, showDuration: false, valueLabel: "Value", valueUnit: "" },
  custom: { label: "Custom", titlePlaceholder: "What did you do?", showValue: true, showDuration: true, valueLabel: "Value", valueUnit: "" },
};

const REMINDER_TYPES = [
  { value: "product", label: "Product Usage", titlePlaceholder: "Pick a product below", usesProduct: true },
  { value: "medication", label: "Medication", titlePlaceholder: "e.g. Take Ashwagandha", usesProduct: true },
  { value: "activity", label: "Activity", titlePlaceholder: "e.g. 20-minute walk", usesProduct: false },
  { value: "water", label: "Water Intake", titlePlaceholder: "e.g. Drink a glass of water", usesProduct: false },
  { value: "measurement", label: "Measurement", titlePlaceholder: "e.g. Log today's weight", usesProduct: false },
  { value: "custom", label: "Custom", titlePlaceholder: "What should we remind you about?", usesProduct: false },
];

type Tab = "goals" | "activities" | "reminders";

/**
 * Journey States (docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md /
 * wellness-journey-v2-report.md, Phase 15) — derived entirely from
 * `wellness_goals`/`wellness_activities` already loaded, never a separate
 * AI call or a new table. Deliberately simple, explainable arithmetic
 * (days-since-last-activity, this-week vs. last-week active-day counts) —
 * consistent with this codebase's "never present a weak signal as a
 * confident fact" rule (see the same analysis doc, Phase 10).
 */
export type JourneyState =
  | "new"
  | "onboarding"
  | "goal_achieved"
  | "maintenance"
  | "at_risk"
  | "struggling"
  | "improving"
  | "active";

const JOURNEY_STATE_COPY: Record<JourneyState, { label: string; coaching: string }> = {
  new: { label: "Getting started", coaching: "Set your first goal to start your journey." },
  onboarding: { label: "Onboarding", coaching: "Log your first activity whenever you're ready — even a small one." },
  goal_achieved: { label: "Goal achieved", coaching: "You reached a goal — nice work. Keep it going, or set a new one." },
  maintenance: { label: "Maintaining", coaching: "No active goal right now — pick your next focus when you're ready." },
  at_risk: { label: "Falling behind", coaching: "It's been a few days — one small action today is enough to restart." },
  struggling: { label: "Finding your footing", coaching: "This week's been light. Try something smaller and more realistic today." },
  improving: { label: "Building momentum", coaching: "You're more consistent than last week — keep the streak going." },
  active: { label: "On track", coaching: "You're keeping a steady pace. Log today's activity when you can." },
};

export function deriveJourneyState(goals: WellnessGoal[], activities: WellnessActivity[]): JourneyState {
  if (goals.length === 0) return "new";
  if (activities.length === 0) return "onboarding";

  const now = Date.now();
  const daysAgo = (dateStr?: string | null) => (dateStr ? (now - new Date(dateStr).getTime()) / 86400000 : Infinity);

  const activeGoals = goals.filter((g) => !g.is_completed);
  const completedGoals = goals.filter((g) => g.is_completed);

  if (completedGoals.some((g) => daysAgo(g.completed_at ?? g.created_at) <= 3)) return "goal_achieved";
  if (activeGoals.length === 0) return "maintenance";

  const activityDaysAgo = activities.map((a) => daysAgo(a.activity_date));
  const daysSinceLastActivity = Math.min(...activityDaysAgo);
  if (daysSinceLastActivity >= 5) return "at_risk";

  const thisWeekDays = new Set(activities.filter((a) => daysAgo(a.activity_date) < 7).map((a) => a.activity_date)).size;
  const lastWeekDays = new Set(
    activities.filter((a) => { const d = daysAgo(a.activity_date); return d >= 7 && d < 14; }).map((a) => a.activity_date),
  ).size;

  if (thisWeekDays <= 1 && daysSinceLastActivity >= 2) return "struggling";
  if (lastWeekDays > 0 && thisWeekDays > lastWeekDays) return "improving";
  return "active";
}

/**
 * "I don't feel like it" mode (Phase 16) — instead of the full plan, ask
 * how much energy/time the user actually has right now and generate the
 * smallest useful action for that budget. Deliberately tiny, generic
 * actions (never invented product/medical advice) so this works for any
 * goal type without guessing what the user's actual goal needs.
 */
const LOW_MOTIVATION_OPTIONS: { value: string; label: string; action: string }[] = [
  { value: "5", label: "5 minutes", action: "Take 5 slow breaths and drink a glass of water." },
  { value: "10", label: "10 minutes", action: "A short walk, or 10 minutes of light stretching." },
  { value: "20", label: "20 minutes", action: "Today's activity, but scaled to fit in 20 minutes." },
  { value: "rest", label: "I need rest", action: "Rest today. Log it — a recovery day still counts." },
];

/**
 * Daily Check-in (spec Phase 4) — deliberately NOT "ask everything every
 * day." Each signal has a `relevantFor` goal-type list; a question is only
 * offered if it's relevant to the user's current priority goal (or has no
 * list, meaning it's a generally-useful default) AND hasn't already been
 * answered today. Capped at 3 questions per check-in (below, in the
 * component) so this stays a 30-90 second interaction, not a form.
 */
const CHECKIN_SIGNALS: { key: string; label: string; relevantFor?: string[] }[] = [
  { key: "energy", label: "How's your energy today?" },
  { key: "sleep", label: "How was your sleep?", relevantFor: ["sleep", "energy", "fitness"] },
  { key: "stress", label: "How stressed do you feel?", relevantFor: ["stress", "general"] },
  { key: "mood", label: "How's your mood?", relevantFor: ["general", "stress", "skin"] },
];
const CHECKIN_SCALE = [1, 2, 3, 4, 5];

/**
 * Recovery Mode (spec Phase 17) — auto-detected from today's check-in
 * signals (never diagnosed, never inferred from anything else). Any one
 * low signal is enough to soften today's coaching — this is deliberately
 * a low bar, since the cost of a gentler day when it wasn't strictly
 * needed is near zero, but the cost of pushing a genuinely depleted user
 * is a lost day (or the whole journey).
 */
export function deriveRecoveryMode(checkin: WellnessCheckin | null): { active: boolean; reason: string | null } {
  const signals = checkin?.signals ?? {};
  if ((signals.sleep ?? 5) <= 2) return { active: true, reason: "you logged low sleep quality today" };
  if ((signals.stress ?? 1) >= 4) return { active: true, reason: "you logged high stress today" };
  if ((signals.energy ?? 5) <= 2) return { active: true, reason: "you logged low energy today" };
  return { active: false, reason: null };
}

/**
 * Current activity streak (spec Phases 8/11) — consecutive days ending
 * today (or yesterday, if today has no activity logged yet, so a streak
 * doesn't reset to 0 the moment you wake up before logging anything) with
 * at least one activity. Pure arithmetic over already-loaded activities,
 * same "no fabricated numbers" rule as everything else in this file.
 */
export function computeCurrentStreak(activities: WellnessActivity[]): number {
  const days = new Set(activities.map((a) => a.activity_date).filter(Boolean));
  const todayStr = new Date().toISOString().slice(0, 10);
  const cursor = new Date();
  if (!days.has(todayStr)) cursor.setDate(cursor.getDate() - 1); // start from yesterday if today's empty
  let streak = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const MILESTONE_COPY: Record<WellnessMilestoneType, { label: string; icon: string }> = {
  first_checkin: { label: "First check-in", icon: "🌱" },
  streak_3: { label: "3-day streak", icon: "🔥" },
  streak_7: { label: "7-day streak", icon: "⭐" },
  goal_completed: { label: "Goal completed", icon: "🏁" },
  personal_best: { label: "Personal best", icon: "🏆" },
};

/**
 * Today's Plan (spec Phase 5) — deliberately a deterministic derivation
 * over real data (priority goal, due reminders, open check-in questions),
 * NOT a separate LLM call — the existing WELLNESS chat intent already
 * covers free-form AI planning conversation; this is the at-a-glance
 * version for the page itself. Capped at 3 priorities so it stays
 * achievable, per the spec's own "don't overwhelm with 15 tasks" rule.
 */
function deriveTodaysPlan(
  priorityGoal: WellnessGoal | undefined,
  checkinQuestionsCount: number,
  dueRemindersToday: Reminder[],
  recoveryActive: boolean,
): { focus: string; why: string; priorities: string[] } {
  const priorities: string[] = [];
  if (checkinQuestionsCount > 0) priorities.push("Do today's quick check-in");
  if (dueRemindersToday.length > 0) priorities.push(`Complete: ${dueRemindersToday[0].title}`);
  if (priorityGoal) {
    priorities.push(
      recoveryActive
        ? `A small step toward "${priorityGoal.title}" — whatever fits today`
        : `Log progress toward "${priorityGoal.title}"`,
    );
  } else if (priorities.length === 0) {
    priorities.push("Set a wellness goal to get a personalized plan");
  }
  return {
    focus: priorityGoal ? priorityGoal.title : "Getting started",
    why: recoveryActive
      ? "Today's plan is scaled back based on your check-in."
      : priorityGoal
        ? "Based on your current goal and recent activity."
        : "No active goal yet — start with one to unlock a real daily plan.",
    priorities: priorities.slice(0, 3),
  };
}

/**
 * Period Summary (spec Phases 21 "Weekly AI Review" and 22 "Monthly Journey
 * Review" — same shape, different window, so implemented once) — built as
 * an arithmetic summary over already-loaded data, not an LLM-generated
 * one, consistent with this file's "never present a weak/fabricated signal
 * as fact" rule. Every line traces to a real count, nothing inferred.
 */
function derivePeriodSummary(activities: WellnessActivity[], milestonesInWindow: WellnessMilestone[], windowDays: number) {
  const now = Date.now();
  const daysAgo = (d?: string | null) => (d ? (now - new Date(d).getTime()) / 86400000 : Infinity);
  const windowActivities = activities.filter((a) => daysAgo(a.activity_date) < windowDays);
  const activeDays = new Set(windowActivities.map((a) => a.activity_date)).size;

  const byWeekday: Record<string, number> = {};
  for (const a of windowActivities) {
    if (!a.activity_date) continue;
    const wd = new Date(a.activity_date).toLocaleDateString("en-US", { weekday: "long" });
    byWeekday[wd] = (byWeekday[wd] ?? 0) + 1;
  }
  const mostConsistentDay = Object.entries(byWeekday).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const periodLabel = windowDays <= 7 ? "this week" : "this period";

  return {
    activeDays,
    windowDays,
    totalLogged: windowActivities.length,
    milestonesCount: milestonesInWindow.length,
    mostConsistentDay,
    wins: [
      ...(activeDays > 0 ? [`${activeDays} active day${activeDays === 1 ? "" : "s"} ${periodLabel}`] : []),
      ...(milestonesInWindow.length > 0 ? [`${milestonesInWindow.length} milestone${milestonesInWindow.length === 1 ? "" : "s"} reached`] : []),
      ...(mostConsistentDay ? [`Most consistent on ${mostConsistentDay}s`] : []),
    ],
    challenges: activeDays < Math.ceil(windowDays * 0.4) ? [`Fewer than ${Math.ceil(windowDays * 0.4)} active days out of ${windowDays} — consistency is the biggest opportunity`] : [],
  };
}

/**
 * Smart Journey Memory (Phase 18) — a fixed, small vocabulary of
 * preference keys rather than free-form key entry, so the AI Coach reading
 * these back (backend/orchestrator/tools/wellness.py) always sees a
 * predictable set of facts instead of arbitrary user-typed keys it has to
 * guess the meaning of.
 */
const WELLNESS_PREF_KEYS: { value: string; label: string }[] = [
  { value: "preferred_time", label: "Preferred time of day" },
  { value: "coaching_style", label: "Coaching style" },
  { value: "dislikes", label: "Dislikes" },
  { value: "equipment", label: "Available equipment" },
  { value: "dietary", label: "Dietary preference" },
];
const WELLNESS_PREF_LABELS: Record<string, string> = Object.fromEntries(
  WELLNESS_PREF_KEYS.map((k) => [k.value, k.label]),
);

export function WellnessJourney() {
  const [tab, setTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<WellnessGoal[]>([]);
  const [activities, setActivities] = useState<WellnessActivity[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Notification opt-in — reuses the existing browser-notification wrapper
  // (src/app/lib/pushNotifications.ts, already used for tickets/training)
  // rather than building a second notification system. Reminders/goal
  // nudges are silently no-ops until the user explicitly grants this —
  // browsers require a user gesture, so this can't be auto-requested.
  const [notifState, setNotifState] = useState<{ subscribed: boolean; supported: boolean } | null>(null);
  useEffect(() => {
    getPushSubscriptionState().then((s) => setNotifState({ subscribed: s.subscribed, supported: s.supported }));
  }, []);
  const enableNotifications = async () => {
    const ok = await subscribeToPush();
    setNotifState({ subscribed: ok, supported: isNotificationSupported() });
  };

  // "I don't feel like it" mode — a tiny 2-step flow (pick a time/energy
  // budget → get the smallest useful action for it), logged as a regular
  // activity (linked to today's priority goal when there is one) so it
  // shows up in progress like anything else, not a separate system.
  const [lowMotivationModal, setLowMotivationModal] = useState(false);
  const [lowMotivationPick, setLowMotivationPick] = useState<string | null>(null);
  const [loggingLowMotivation, setLoggingLowMotivation] = useState(false);
  const logLowMotivationAction = async (goalId: string | undefined) => {
    const option = LOW_MOTIVATION_OPTIONS.find((o) => o.value === lowMotivationPick);
    if (!option) return;
    setLoggingLowMotivation(true);
    try {
      await customerLogWellnessActivity({
        activity_type: "custom",
        title: option.action,
        duration_minutes: option.value !== "rest" ? Number(option.value) : null,
        notes: "Logged via \"I don't feel like it\" mode",
        goal_id: goalId || null,
      });
      setLowMotivationModal(false);
      setLowMotivationPick(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoggingLowMotivation(false);
    }
  };

  // Daily Check-in (Phase 4) — adaptive: only the questions relevant to
  // today's priority goal and not already answered today are offered (see
  // CHECKIN_SIGNALS), capped at 3. Answers merge into today's row
  // server-side (backend/customer_api.py upsert_today_checkin), so
  // answering more later the same day never loses earlier answers.
  const [checkinModal, setCheckinModal] = useState(false);
  const [checkinAnswers, setCheckinAnswers] = useState<Record<string, number>>({});
  const [savingCheckin, setSavingCheckin] = useState(false);
  const saveCheckin = async () => {
    if (Object.keys(checkinAnswers).length === 0) { setCheckinModal(false); return; }
    setSavingCheckin(true);
    try {
      const updated = await customerUpsertCheckin(checkinAnswers);
      setTodayCheckin(updated);
      setCheckinModal(false);
      setCheckinAnswers({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingCheckin(false);
    }
  };

  // Smart Journey Memory (Phase 18) — a small fixed set of preference keys
  // (not free-form key entry) so the AI Coach reading these back
  // (backend/orchestrator/tools/wellness.py) always sees a predictable
  // vocabulary rather than arbitrary user-typed keys.
  const [newPrefKey, setNewPrefKey] = useState("");
  const [newPrefValue, setNewPrefValue] = useState("");
  const [savingPref, setSavingPref] = useState(false);
  const savePreference = async () => {
    if (!newPrefKey || !newPrefValue.trim()) return;
    setSavingPref(true);
    try {
      await customerUpsertWellnessPreference(newPrefKey, newPrefValue.trim());
      setNewPrefKey("");
      setNewPrefValue("");
      setPreferences(await customerListWellnessPreferences());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingPref(false);
    }
  };
  const forgetPreference = async (key: string) => {
    await customerDeleteWellnessPreference(key);
    setPreferences((prev) => prev.filter((p) => p.key !== key));
  };
  // Promotes an AI-tentative signal (inferred_conversation/ai_recommendation)
  // to a confirmed fact — the only way that ever happens, per the backend's
  // provenance rules (see backend/customer_api.py's /confirm endpoint).
  const confirmPreference = async (key: string) => {
    const confirmed = await customerConfirmWellnessPreference(key);
    setPreferences((prev) => prev.map((p) => (p.key === key ? confirmed : p)));
  };

  // Goal modal — target_value/unit start from the "general" preset instead
  // of blank, so the very first render already shows a sensible example
  // rather than an empty box with no clue what to type.
  const [goalModal, setGoalModal] = useState(false);
  const [goalForm, setGoalForm] = useState({
    goal_type: "general",
    title: "",
    target_value: GOAL_TYPE_PRESETS.general.defaultTarget,
    unit: GOAL_TYPE_PRESETS.general.defaultUnit,
    target_date: "",
  });
  const [savingGoal, setSavingGoal] = useState(false);

  // Activity modal
  const [actModal, setActModal] = useState(false);
  const [actForm, setActForm] = useState({ activity_type: "custom", title: "", value: "", unit: "", duration_minutes: "", notes: "", goal_id: "" });
  const [savingAct, setSavingAct] = useState(false);

  // Reminder modal
  const [remModal, setRemModal] = useState(false);
  const [remForm, setRemForm] = useState({ reminder_type: "product", title: "", time_of_day: "09:00", frequency: "daily", product_id: "" });
  const [savingRem, setSavingRem] = useState(false);
  // Loaded lazily the first time a product-based reminder type is picked —
  // most reminders never need this list, so it isn't fetched up front.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsLoadFailed, setProductsLoadFailed] = useState(false);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const [todayCheckin, setTodayCheckin] = useState<WellnessCheckin | null>(null);
  const [preferences, setPreferences] = useState<WellnessPreference[]>([]);
  const [milestones, setMilestones] = useState<WellnessMilestone[]>([]);
  const [weeklyReviewOpen, setWeeklyReviewOpen] = useState(false);
  // Same modal, two windows — spec Phases 21 (weekly) and 22 (monthly) share
  // an identical shape (derivePeriodSummary), so one toggle covers both
  // instead of a second modal.
  const [reviewWindowDays, setReviewWindowDays] = useState<7 | 30>(7);
  // Set right after a milestone is newly recorded this session, so the AI
  // Reflection prompt (Phase 12) only ever appears once, right when it
  // happened — not retroactively on every future page load.
  const [reflectionMilestone, setReflectionMilestone] = useState<WellnessMilestone | null>(null);
  const [reflectionText, setReflectionText] = useState("");
  const [savingReflection, setSavingReflection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, a, r, c, p, m] = await Promise.all([
        customerListWellnessGoals(),
        customerListWellnessActivities(30),
        customerListReminders(true),
        customerGetTodayCheckin(),
        customerListWellnessPreferences(),
        customerListWellnessMilestones(),
      ]);
      setGoals(g); setActivities(a); setReminders(r); setTodayCheckin(c); setPreferences(p); setMilestones(m);

      // Milestone detection (Phase 11) — re-evaluated on every load;
      // creation is idempotent server-side, so this never double-awards.
      // Only prompts AI Reflection for something detected as genuinely NEW
      // this call (not already in the milestones list we just loaded).
      const existingTypes = new Set(m.map((x) => `${x.milestone_type}:${x.goal_id ?? ""}`));
      const toCreate: { type: WellnessMilestoneType; goalId?: string }[] = [];
      if (c.signals && Object.keys(c.signals).length > 0 && !existingTypes.has("first_checkin:")) {
        toCreate.push({ type: "first_checkin" });
      }
      const streak = computeCurrentStreak(a);
      if (streak >= 7 && !existingTypes.has("streak_7:")) toCreate.push({ type: "streak_7" });
      else if (streak >= 3 && !existingTypes.has("streak_3:")) toCreate.push({ type: "streak_3" });
      for (const goal of g) {
        if (goal.is_completed && goal.id && !existingTypes.has(`goal_completed:${goal.id}`)) {
          toCreate.push({ type: "goal_completed", goalId: goal.id });
        }
      }
      if (toCreate.length > 0) {
        const created = await Promise.all(toCreate.map((t) => customerCreateWellnessMilestone(t.type, t.goalId)));
        setMilestones((prev) => [...created, ...prev]);
        setReflectionMilestone(created[created.length - 1]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveReflection = async () => {
    if (!reflectionMilestone?.id || !reflectionText.trim()) { setReflectionMilestone(null); return; }
    setSavingReflection(true);
    try {
      await customerAddMilestoneReflection(reflectionMilestone.id, reflectionText.trim());
      setMilestones((prev) => prev.map((m) => (m.id === reflectionMilestone.id ? { ...m, reflection: reflectionText.trim() } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingReflection(false);
      setReflectionMilestone(null);
      setReflectionText("");
    }
  };

  // Applies a goal type's preset target/unit whenever the user picks a
  // different type — keeps the fields relevant instead of carrying over a
  // "/10" unit onto a Weight goal or vice versa.
  const selectGoalType = (goalType: string) => {
    const preset = GOAL_TYPE_PRESETS[goalType] ?? GOAL_TYPE_PRESETS.general;
    setGoalForm({ ...goalForm, goal_type: goalType, target_value: preset.defaultTarget, unit: preset.defaultUnit });
  };

  const saveGoal = async () => {
    if (!goalForm.title.trim()) return;
    setSavingGoal(true);
    try {
      await customerCreateWellnessGoal({
        goal_type: goalForm.goal_type, title: goalForm.title,
        target_value: goalForm.target_value ? parseFloat(goalForm.target_value) : null,
        unit: goalForm.unit, target_date: goalForm.target_date || null,
      });
      setGoalModal(false);
      setGoalForm({ goal_type: "general", title: "", target_value: GOAL_TYPE_PRESETS.general.defaultTarget, unit: GOAL_TYPE_PRESETS.general.defaultUnit, target_date: "" });
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

  // Applies a type's default unit and clears whichever of value/duration
  // that type doesn't use, so e.g. switching from "Workout" (duration) to
  // "Water Intake" (value) doesn't leave a stale duration behind.
  const selectActivityType = (activityType: string) => {
    const preset = ACTIVITY_TYPE_PRESETS[activityType] ?? ACTIVITY_TYPE_PRESETS.custom;
    setActForm({
      ...actForm,
      activity_type: activityType,
      unit: preset.valueUnit ?? "",
      value: preset.showValue ? actForm.value : "",
      duration_minutes: preset.showDuration ? actForm.duration_minutes : "",
    });
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
        // When linked to a goal, the backend auto-advances that goal's
        // current_value from this activity — reloading below (`load()`)
        // picks up the updated goal alongside the new activity, so the
        // Goals tab's progress bar reflects it without a second write.
        goal_id: actForm.goal_id || null,
      });
      setActModal(false); setActForm({ activity_type: "custom", title: "", value: "", unit: "", duration_minutes: "", notes: "", goal_id: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSavingAct(false); }
  };

  // Products are fetched lazily the first time a "product"/"medication"
  // reminder type is selected — most reminder types never need this list.
  //
  // getProducts() (used elsewhere in the app) silently falls back to a
  // handful of demo products on ANY query error, by design, so every other
  // page never crashes over it — but that also makes "the real catalog
  // genuinely has few products" and "the query actually failed"
  // indistinguishable to any UI built on it. getProductsDiagnostic()
  // (lib/db.ts) runs the exact same query but reports whether the
  // fallback fired and the real error message, so this picker can show
  // an honest "couldn't load — here's why" instead of guessing from the
  // result size. `force` re-runs the fetch (Retry button).
  const loadProducts = async (force: boolean) => {
    if (products !== null && !force) return;
    setProducts([]); // "loading" sentinel
    setProductsLoadFailed(false);
    setProductsLoadError(null);
    const { products: rows, usedFallback, error: loadError } = await getProductsDiagnostic();
    setProducts(rows);
    if (usedFallback) {
      setProductsLoadFailed(true);
      setProductsLoadError(loadError);
    }
  };
  const ensureProductsLoaded = () => void loadProducts(false);

  const selectReminderType = (reminderType: string) => {
    const preset = REMINDER_TYPES.find((t) => t.value === reminderType);
    setRemForm({ ...remForm, reminder_type: reminderType, product_id: "" });
    if (preset?.usesProduct) ensureProductsLoaded();
  };

  const selectReminderProduct = (product: Product) => {
    setRemForm({
      ...remForm,
      product_id: product.id ?? "",
      // Only overwrite the title if the user hasn't already typed one —
      // don't clobber a custom reminder title they already wrote.
      title: remForm.title.trim() ? remForm.title : product.product_name,
    });
  };

  const saveReminder = async () => {
    if (!remForm.title.trim()) return;
    setSavingRem(true);
    try {
      await customerCreateReminder({
        reminder_type: remForm.reminder_type, title: remForm.title,
        time_of_day: remForm.time_of_day, frequency: remForm.frequency,
        product_id: remForm.product_id || null,
      });
      setRemModal(false); setRemForm({ reminder_type: "product", title: "", time_of_day: "09:00", frequency: "daily", product_id: "" });
      setProductSearch("");
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

  const activeGoals = goals.filter((g) => !g.is_completed);

  /**
   * Overview data — every number here is computed from goals/activities
   * already loaded above, never a fabricated "wellness score" (see
   * docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_PROMPT.md Step 1/11's rule
   * that every summary number must trace to real data).
   */
  const todayStr = new Date().toISOString().slice(0, 10);
  const activeDaysThisWeek = new Set(
    activities
      .filter((a) => {
        if (!a.activity_date) return false;
        const days = (Date.now() - new Date(a.activity_date).getTime()) / 86400000;
        return days >= 0 && days < 7;
      })
      .map((a) => a.activity_date),
  ).size;
  const loggedTodayGoalIds = new Set(
    activities.filter((a) => a.activity_date === todayStr && a.goal_id).map((a) => a.goal_id),
  );
  // "Today's priority": the first active goal with no activity logged
  // against it today — not just "the first goal", so this actually reflects
  // what still needs attention rather than an arbitrary pick.
  const priorityGoal = activeGoals.find((g) => !g.id || !loggedTodayGoalIds.has(g.id));

  const journeyState = deriveJourneyState(goals, activities);
  const stateCopy = JOURNEY_STATE_COPY[journeyState];
  const recoveryMode = deriveRecoveryMode(todayCheckin);

  // Which check-in questions to offer right now: relevant to the priority
  // goal's type (or generally relevant) AND not already answered today —
  // capped at 3 so this stays a quick check-in, never a form.
  const answeredToday = new Set(Object.keys(todayCheckin?.signals ?? {}));
  const checkinQuestions = CHECKIN_SIGNALS.filter((q) => {
    if (answeredToday.has(q.key)) return false;
    if (!q.relevantFor) return true;
    return !priorityGoal || q.relevantFor.includes(priorityGoal.goal_type ?? "general");
  }).slice(0, 3);

  // Wellness Momentum (Phase 8) — transparent by construction: the two
  // numbers shown ARE the formula, not an opaque score derived from them.
  const activeDaysLastWeek = new Set(
    activities
      .filter((a) => {
        if (!a.activity_date) return false;
        const days = (Date.now() - new Date(a.activity_date).getTime()) / 86400000;
        return days >= 7 && days < 14;
      })
      .map((a) => a.activity_date),
  ).size;
  const currentStreak = computeCurrentStreak(activities);

  const dueRemindersToday = reminders; // reminders list is already "active"; no per-reminder due-time comparison needed here (that's the server-side notification check) — this just surfaces what's on today's plate.
  const todaysPlan = deriveTodaysPlan(priorityGoal, checkinQuestions.length, dueRemindersToday, recoveryMode.active);

  const milestonesInReviewWindow = milestones.filter((m) => {
    if (!m.achieved_at) return false;
    return (Date.now() - new Date(m.achieved_at).getTime()) / 86400000 < reviewWindowDays;
  });
  const periodSummary = derivePeriodSummary(activities, milestonesInReviewWindow, reviewWindowDays);

  // Personalization Levels (spec Phase 19) — the system must never claim a
  // level it hasn't earned with real data, so this is a strict, ordered
  // check (not a weighted score) over things that actually exist: a
  // profile-ish signal (a remembered preference), a goal, ~a week of
  // behavioral data, then adaptive state actually kicking in.
  const personalizationLevel = (() => {
    if (journeyState !== "new" && journeyState !== "onboarding" && (journeyState === "improving" || journeyState === "struggling" || journeyState === "at_risk")) return 5;
    if (activeDaysThisWeek + activeDaysLastWeek >= 5) return 4;
    if (activities.length >= 3) return 3;
    if (goals.length > 0) return 2;
    if (preferences.length > 0) return 1;
    return 0;
  })();
  const PERSONALIZATION_LEVEL_LABELS = [
    "No personalization yet",
    "Profile personalization",
    "Goal personalization",
    "Behavior personalization",
    "Conversation personalization",
    "Adaptive personalization",
  ];

  const tabs: { value: Tab; label: string; icon: typeof Target; count?: number }[] = [
    { value: "goals", label: "Goals", icon: Target, count: goals.filter((g) => !g.is_completed).length },
    { value: "activities", label: "Activities", icon: Activity, count: activities.length },
    { value: "reminders", label: "Reminders", icon: Bell, count: reminders.length },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Wellness Journey"
        subtitle="Set goals, track activities, and manage reminders."
        icon={Target}
      />
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full">
      {error ? <ErrorState message={error} /> : null}

      {/* Notification opt-in banner — only shown when supported and not
          yet enabled; disappears once granted (or if the browser can't do
          notifications at all, e.g. iOS Safari outside an installed PWA). */}
      {notifState && notifState.supported && !notifState.subscribed ? (
        <Card className="p-3 mb-4 shadow-none border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <BellRing className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Get reminded on this device</p>
            <p className="text-xs text-muted-foreground">Enable notifications so your reminders actually reach you, not just this page.</p>
          </div>
          <Button type="button" size="sm" onClick={enableNotifications} className="shrink-0">Enable</Button>
        </Card>
      ) : null}

      {/* Recovery Mode (Phase 17) — auto-detected from today's check-in
          signals only (never diagnosed from anything else). Shown ahead of
          the normal Overview card so a depleted day is acknowledged before
          any "stay consistent" coaching copy, not alongside it. */}
      {!loading && recoveryMode.active ? (
        <Card className="p-4 mb-4 shadow-none border-warning/30 bg-warning/5">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-warning/15 text-warning flex items-center justify-center shrink-0">
              <HeartPulse className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Recovery mode</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Today's plan is scaled back because {recoveryMode.reason} — that's fine, a lighter day still counts.
              </p>
              {activeGoals.length > 0 ? (
                <button type="button" onClick={() => setLowMotivationModal(true)} className="text-xs font-medium text-warning hover:underline mt-2">
                  Get today's smallest action
                </button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Daily Check-in (Phase 4) — only shown while there's something left
          to ask today; disappears once all relevant questions are
          answered instead of staying as permanent clutter. */}
      {!loading && checkinQuestions.length > 0 ? (
        <Card className="p-3 mb-4 shadow-none border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <Sunrise className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Quick check-in</p>
            <p className="text-xs text-muted-foreground">{checkinQuestions.length} question{checkinQuestions.length === 1 ? "" : "s"} — takes under a minute.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setCheckinModal(true)} className="shrink-0">Check in</Button>
        </Card>
      ) : null}

      {/* Overview — a data-grounded summary + one surfaced next action,
          instead of three equally-weighted stat tiles with nothing telling
          the user what to actually do next. Only renders once there's
          something to summarize (empty-state below already covers the
          "no goals yet" case). Journey-state-aware (Phase 15): the
          coaching line changes based on real recent behavior, not a static
          message every time. */}
      {!loading && goals.length > 0 ? (
        <Card className="p-4 mb-4 shadow-none border-primary/20 bg-primary/5">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">
                  {activeDaysThisWeek > 0
                    ? `${activeDaysThisWeek} active day${activeDaysThisWeek === 1 ? "" : "s"} this week`
                    : "No activity logged yet this week"}
                </p>
                <Badge variant="secondary" className="text-[10px]">{stateCopy.label}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{stateCopy.coaching}</p>
              {priorityGoal ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Today's priority: <span className="text-foreground font-medium">{priorityGoal.title}</span>
                </p>
              ) : null}
              {activeGoals.length > 0 && !recoveryMode.active ? (
                <button
                  type="button"
                  onClick={() => setLowMotivationModal(true)}
                  className="text-xs font-medium text-primary hover:underline mt-2"
                >
                  Not feeling it today?
                </button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Today's Plan (Phase 5) — deterministic, not a separate AI call
          (see deriveTodaysPlan's own comment). Answers "what should I do
          today, and why" directly, per the spec's Phase 23 UI requirement. */}
      {!loading && goals.length > 0 ? (
        <Card className="p-4 mb-4 shadow-none">
          <h3 className="text-sm font-semibold mb-0.5">Today's focus: {todaysPlan.focus}</h3>
          <p className="text-xs text-muted-foreground mb-2">{todaysPlan.why}</p>
          <ul className="space-y-1">
            {todaysPlan.priorities.map((p, i) => (
              <li key={i} className="text-sm flex items-start gap-1.5">
                <span className="text-primary font-medium shrink-0">{i + 1}.</span> {p}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Wellness Momentum (Phase 8) — transparent by construction: the
          label states exactly what's counted, no hidden formula behind a
          bare number. Never shown standalone without its own explanation,
          per the spec's explicit "not a medical assessment" requirement. */}
      {!loading && activities.length > 0 ? (
        <Card className="p-4 mb-4 shadow-none">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Gauge className="w-4 h-4 text-primary" /> Wellness momentum</h3>
            <button type="button" onClick={() => setWeeklyReviewOpen(true)} className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> This week
            </button>
          </div>
          <p className="text-2xl font-semibold">
            {activeDaysThisWeek}/7 <span className="text-sm font-normal text-muted-foreground">active days this week</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeDaysThisWeek === activeDaysLastWeek
              ? `Same as last week (${activeDaysLastWeek}/7).`
              : activeDaysThisWeek > activeDaysLastWeek
                ? `Up from ${activeDaysLastWeek}/7 last week.`
                : `Down from ${activeDaysLastWeek}/7 last week.`}
            {currentStreak > 0 ? ` Current streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}.` : ""}
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            Wellness guidance, not a medical assessment — counts distinct days with a logged activity.
          </p>
        </Card>
      ) : null}

      {/* Journey Milestones (Phase 11) — a subtle strip of badges, not a
          gamified progress bar. Tapping one that has no reflection yet
          opens the AI Reflection prompt for it. */}
      {!loading && milestones.length > 0 ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-4">
          <Award className="w-4 h-4 text-primary shrink-0" />
          {milestones.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { if (!m.reflection) { setReflectionMilestone(m); setReflectionText(""); } }}
              title={m.reflection ? m.reflection : "Tap to add a reflection"}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent text-accent-foreground text-xs whitespace-nowrap"
            >
              {MILESTONE_COPY[m.milestone_type]?.icon} {MILESTONE_COPY[m.milestone_type]?.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="p-3 text-center shadow-none"><p className="text-2xl font-semibold text-primary">{activeGoals.length}</p><p className="text-[10px] text-muted-foreground">Active Goals</p></Card>
        <Card className="p-3 text-center shadow-none"><p className="text-2xl font-semibold">{goals.filter((g) => g.is_completed).length}</p><p className="text-[10px] text-muted-foreground">Completed</p></Card>
        <Card className="p-3 text-center shadow-none"><p className="text-2xl font-semibold">{reminders.length}</p><p className="text-[10px] text-muted-foreground">Reminders</p></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
            {t.count != null && t.count > 0 ? <Badge variant="secondary">{t.count}</Badge> : null}
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : null}

      {/* Goals tab */}
      {tab === "goals" && !loading ? (
        <>
          <div className="flex justify-center mb-3">
            <Button type="button" onClick={() => setGoalModal(true)}><Plus className="w-4 h-4" /> Add Goal</Button>
          </div>
          {goals.length === 0 ? <Card className="shadow-none"><EmptyState title="No goals yet" description="Set your first wellness goal to start your journey." icon={<Target className="w-5 h-5" />} /></Card> : (
            <div className="space-y-2">
              {goals.map((g) => {
                const target = Number(g.target_value || 0);
                const current = Number(g.current_value || 0);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const goalType = GOAL_TYPES.find((t) => t.value === g.goal_type);
                return (
                  <Card key={g.id} className={`p-3 shadow-none ${g.is_completed ? "border-primary/30 bg-primary/5" : ""}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{goalType?.icon || "🎯"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {goalType?.label || "Goal"} · {current}/{target}
                          {g.unit ? (g.unit.startsWith("/") ? g.unit : ` ${g.unit}`) : ""}
                        </p>
                      </div>
                      {g.is_completed ? <Check className="w-4 h-4 text-primary" /> : null}
                      <Button type="button" variant="ghost" size="icon" onClick={() => deleteGoal(g)} className="h-auto w-auto p-1.5 text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                    {!g.is_completed && target > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><ProgressBar value={pct} showLabel /></div>
                        {target > 0 ? (
                          <>
                            <Button type="button" variant="secondary" size="sm" onClick={() => updateGoalProgress(g, -1)} className="h-6 w-6 p-0 text-xs">−</Button>
                            <Button type="button" variant="secondary" size="sm" onClick={() => updateGoalProgress(g, 1)} className="h-6 w-6 p-0 text-xs">+</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => completeGoal(g)} className="text-xs border-primary/30 text-primary hover:bg-primary/10">Done</Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {/* Activities tab */}
      {tab === "activities" && !loading ? (
        <>
          <div className="flex justify-center mb-3">
            <Button type="button" onClick={() => setActModal(true)}><Plus className="w-4 h-4" /> Log Activity</Button>
          </div>
          {trendData.length > 0 ? (
            <Card className="p-4 mb-3 shadow-none">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Activity Trend</h3>
              <LineChart data={trendData} height={160} />
            </Card>
          ) : null}
          {activities.length === 0 ? <Card className="shadow-none"><EmptyState title="No activities logged" icon={<Activity className="w-5 h-5" />} /></Card> : (
            <div className="space-y-1.5">
              {activities.map((a) => (
                <Card key={a.id} className="p-2 flex items-center gap-2 text-xs shadow-none">
                  <Activity className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.title}</p>
                    <p className="text-[10px] text-muted-foreground">{a.activity_date} · {a.value ? `${a.value} ${a.unit || ""}` : ""}{a.duration_minutes ? ` · ${a.duration_minutes}min` : ""}</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Reminders tab */}
      {tab === "reminders" && !loading ? (
        <>
          <div className="flex justify-center mb-3">
            <Button type="button" onClick={() => { setRemModal(true); ensureProductsLoaded(); }}><Plus className="w-4 h-4" /> Add Reminder</Button>
          </div>
          {reminders.length === 0 ? <Card className="shadow-none"><EmptyState title="No reminders" description="Set reminders for product usage, medications, or activities." icon={<Bell className="w-5 h-5" />} /></Card> : (
            <div className="space-y-2">
              {reminders.map((r) => (
                <Card key={r.id} className="p-3 flex items-center gap-2 shadow-none">
                  <Bell className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{r.reminder_type} · {r.frequency} · {r.time_of_day}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => deleteReminder(r)} className="h-auto w-auto p-1.5 text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></Button>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Smart Journey Memory (Phase 18) — durable preferences the AI Coach
          reads back (backend/orchestrator/tools/wellness.py) so it doesn't
          ask the same thing twice. Deliberately a small fixed key
          vocabulary, not free-form keys, and shown regardless of which tab
          is active since it's about the whole journey, not one goal. */}
      {!loading ? (
        <Card className="p-4 mt-2 shadow-none">
          <h3 className="text-sm font-semibold mb-1">Wellness memory</h3>
          <p className="text-xs text-muted-foreground mb-3">
            What the AI coach remembers about your preferences — used when it suggests goals or plans, never asked twice.
          </p>
          {preferences.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {preferences.map((p) => {
                const isFact = p.provenance === "user_provided" || p.provenance === "verified_import";
                return (
                  <span
                    key={p.key}
                    title={
                      isFact
                        ? "You confirmed this"
                        : `AI ${p.provenance === "ai_recommendation" ? "suggestion" : "guess"} — not confirmed${p.confidence != null ? ` (${Math.round(p.confidence * 100)}% confidence)` : ""}`
                    }
                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs ${
                      isFact
                        ? "bg-accent text-accent-foreground"
                        : "bg-transparent border border-dashed border-muted-foreground/40 text-muted-foreground"
                    }`}
                  >
                    {!isFact && <span className="italic">AI guess:</span>}
                    {WELLNESS_PREF_LABELS[p.key] ?? p.key}: {p.value}
                    {!isFact && (
                      <button type="button" onClick={() => void confirmPreference(p.key)} aria-label={`Confirm ${p.key}`} className="hover:text-primary font-medium">
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button type="button" onClick={() => void forgetPreference(p.key)} aria-label={`Forget ${p.key}`} className="hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">Nothing remembered yet.</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={newPrefKey} onChange={(e) => setNewPrefKey(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
              <option value="">Remember…</option>
              {WELLNESS_PREF_KEYS.filter((k) => !preferences.some((p) => p.key === k.value)).map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <input type="text" value={newPrefValue} onChange={(e) => setNewPrefValue(e.target.value)}
              placeholder="e.g. Mornings" className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm" />
            <Button type="button" variant="secondary" disabled={!newPrefKey || !newPrefValue.trim() || savingPref} onClick={() => void savePreference()}>
              {savingPref ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
            </Button>
          </div>
        </Card>
      ) : null}
      </div>
      </div>

      {/* Goal modal */}
      <Modal open={goalModal} onClose={() => setGoalModal(false)} title="New Wellness Goal" size="md"
        footer={<><Button type="button" variant="secondary" onClick={() => setGoalModal(false)}><X className="w-4 h-4" /> Cancel</Button>
          <Button type="button" onClick={saveGoal} disabled={savingGoal}>{savingGoal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Goal Type</label>
            <div className="grid grid-cols-3 gap-1.5">
              {GOAL_TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => selectGoalType(t.value)}
                  className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border text-xs ${goalForm.goal_type === t.value ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="text-lg">{t.icon}</span>{t.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const preset = GOAL_TYPE_PRESETS[goalForm.goal_type] ?? GOAL_TYPE_PRESETS.general;
            return (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
                  <input type="text" value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                    placeholder={preset.titlePlaceholder} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{preset.targetLabel}</label>
                  <p className="text-[11px] text-muted-foreground mb-1.5">{preset.targetHint}</p>
                  {preset.mode === "rating" ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" size="sm" className="h-8 w-8 p-0"
                        onClick={() => setGoalForm({ ...goalForm, target_value: String(Math.max(1, Number(goalForm.target_value || 8) - 1)) })}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <div className="flex-1 text-center text-lg font-semibold">{goalForm.target_value || 8}<span className="text-xs text-muted-foreground font-normal"> /10</span></div>
                      <Button type="button" variant="secondary" size="sm" className="h-8 w-8 p-0"
                        onClick={() => setGoalForm({ ...goalForm, target_value: String(Math.min(10, Number(goalForm.target_value || 8) + 1)) })}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input type="number" value={goalForm.target_value} onChange={(e) => setGoalForm({ ...goalForm, target_value: e.target.value })}
                        placeholder="Amount" className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm" />
                      <div className="flex gap-1 shrink-0">
                        {preset.units.map((u) => (
                          <button key={u} type="button" onClick={() => setGoalForm({ ...goalForm, unit: u })}
                            className={`px-2.5 py-2 rounded-lg border text-xs font-medium ${goalForm.unit === u ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                            {u}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Target date (optional)</label>
                  <input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
                </div>
              </>
            );
          })()}
        </div>
      </Modal>

      {/* Activity modal */}
      <Modal open={actModal} onClose={() => setActModal(false)} title="Log Activity" size="sm"
        footer={<><Button type="button" variant="secondary" onClick={() => setActModal(false)}>Cancel</Button>
          <Button type="button" onClick={saveActivity} disabled={savingAct}>{savingAct ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Log</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Type</label>
            <select value={actForm.activity_type} onChange={(e) => selectActivityType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {Object.entries(ACTIVITY_TYPE_PRESETS).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
            </select>
          </div>
          {(() => {
            const preset = ACTIVITY_TYPE_PRESETS[actForm.activity_type] ?? ACTIVITY_TYPE_PRESETS.custom;
            return (
              <>
                <div><label className="block text-xs text-muted-foreground mb-1">Title</label>
                  <input type="text" value={actForm.title} onChange={(e) => setActForm({ ...actForm, title: e.target.value })}
                    placeholder={preset.titlePlaceholder} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
                </div>
                {preset.showValue ? (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{preset.valueLabel}</label>
                    <input type="number" value={actForm.value} onChange={(e) => setActForm({ ...actForm, value: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
                    {preset.quickValues ? (
                      <div className="flex gap-1.5 mt-1.5">
                        {preset.quickValues.map((v) => (
                          <button key={v} type="button" onClick={() => setActForm({ ...actForm, value: String(v) })}
                            className={`px-2.5 py-1 rounded-full border text-xs font-medium ${actForm.value === String(v) ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                            {v}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {preset.showDuration ? (
                  <div><label className="block text-xs text-muted-foreground mb-1">Duration (minutes)</label>
                    <input type="number" value={actForm.duration_minutes} onChange={(e) => setActForm({ ...actForm, duration_minutes: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
                  </div>
                ) : null}
              </>
            );
          })()}
          {activeGoals.length > 0 ? (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Counts toward goal (optional)</label>
              <select value={actForm.goal_id} onChange={(e) => setActForm({ ...actForm, goal_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                <option value="">Not linked to a goal</option>
                {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Reminder modal */}
      <Modal open={remModal} onClose={() => setRemModal(false)} title="New Reminder" size="sm"
        footer={<><Button type="button" variant="secondary" onClick={() => setRemModal(false)}>Cancel</Button>
          <Button type="button" onClick={saveReminder} disabled={savingRem}>{savingRem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Type</label>
            <select value={remForm.reminder_type} onChange={(e) => selectReminderType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {REMINDER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {(() => {
            const preset = REMINDER_TYPES.find((t) => t.value === remForm.reminder_type) ?? REMINDER_TYPES[0];
            if (!preset.usesProduct) return null;
            // Alphabetical, not "newest first" (getProducts()'s default
            // order) — browsing ~185 products to find one by name only
            // works if the list is sorted the way you'd expect a directory
            // to be, not by when it happened to be added.
            const sorted = [...(products ?? [])].sort((a, b) => a.product_name.localeCompare(b.product_name));
            const filtered = sorted.filter((p) =>
              !productSearch.trim() || p.product_name.toLowerCase().includes(productSearch.trim().toLowerCase()),
            );
            const selected = sorted.find((p) => p.id === remForm.product_id);
            const isLoading = products !== null && products.length === 0 && !productsLoadFailed;
            return (
              <div>
                <label className="block text-xs text-muted-foreground mb-1 flex items-center justify-between">
                  <span>Product</span>
                  {products && products.length > 0 ? (
                    <span className="text-muted-foreground/70">{filtered.length} of {products.length}</span>
                  ) : null}
                </label>
                {selected ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-sm">
                    <span className="truncate">{selected.product_name}</span>
                    <button type="button" onClick={() => setRemForm({ ...remForm, product_id: "" })} className="text-muted-foreground hover:text-foreground shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search Dayjoy products…" className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm" />
                    </div>
                    {productsLoadFailed ? (
                      <div className="mt-1.5 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-destructive font-medium">Couldn't load the full product list — showing a few defaults.</p>
                          <button type="button" onClick={() => void loadProducts(true)} className="text-[11px] font-medium text-destructive underline shrink-0">
                            Retry
                          </button>
                        </div>
                        {productsLoadError ? <p className="text-[10px] text-destructive/70 mt-1">{productsLoadError}</p> : null}
                      </div>
                    ) : isLoading ? (
                      <p className="text-[11px] text-muted-foreground mt-1">Loading products…</p>
                    ) : (
                      // No cap — this IS the "browse all products" dropdown,
                      // not a top-N preview; the scroll container is what
                      // keeps it usable, not truncating the list.
                      // onWheel/onTouchMove stopPropagation: this list sits
                      // inside the Modal's own scrollable body, and without
                      // this a scroll gesture that starts over the list
                      // (very likely with ~180 items) got captured by the
                      // outer modal instead of scrolling the list itself.
                      <div
                        className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border overscroll-contain"
                        onWheel={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                      >
                        {filtered.map((p) => (
                          <button key={p.id} type="button" onClick={() => selectReminderProduct(p)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors truncate">
                            {p.product_name}
                          </button>
                        ))}
                        {filtered.length === 0 ? <p className="px-3 py-2 text-xs text-muted-foreground">No matching products</p> : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
          <div><label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input type="text" value={remForm.title} onChange={(e) => setRemForm({ ...remForm, title: e.target.value })}
              placeholder={(REMINDER_TYPES.find((t) => t.value === remForm.reminder_type) ?? REMINDER_TYPES[0]).titlePlaceholder}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs text-muted-foreground mb-1">Time</label><input type="time" value={remForm.time_of_day} onChange={(e) => setRemForm({ ...remForm, time_of_day: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
            <div><label className="block text-xs text-muted-foreground mb-1">Frequency</label><select value={remForm.frequency} onChange={(e) => setRemForm({ ...remForm, frequency: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
          </div>
        </div>
      </Modal>

      {/* "I don't feel like it" mode (Phase 16) — pick a realistic time/
          energy budget, get the smallest useful action for it, log it as
          a normal activity (linked to today's priority goal if there is
          one) so it counts toward real progress instead of the user just
          abandoning the day entirely. */}
      <Modal
        open={lowMotivationModal}
        onClose={() => { setLowMotivationModal(false); setLowMotivationPick(null); }}
        title="Not feeling it today?"
        description="That's fine — let's find something small enough to still count."
        size="sm"
        footer={<>
          <Button type="button" variant="secondary" onClick={() => { setLowMotivationModal(false); setLowMotivationPick(null); }}>Cancel</Button>
          <Button type="button" disabled={!lowMotivationPick || loggingLowMotivation} onClick={() => void logLowMotivationAction(priorityGoal?.id)}>
            {loggingLowMotivation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Log it
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {LOW_MOTIVATION_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setLowMotivationPick(o.value)}
                className={`p-3 rounded-lg border text-sm font-medium text-left ${lowMotivationPick === o.value ? "border-primary bg-primary/5 text-primary" : "border-border"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {lowMotivationPick ? (
            <div className="rounded-lg border border-border bg-accent/20 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Today's action</p>
              <p className="text-sm">{LOW_MOTIVATION_OPTIONS.find((o) => o.value === lowMotivationPick)?.action}</p>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Daily Check-in (Phase 4) — 1-3 adaptive questions (see
          checkinQuestions above), each a 1-5 tap, no typing. Answers merge
          into today's row so partial check-ins (answer 1 now, rest later)
          never lose progress. */}
      <Modal
        open={checkinModal}
        onClose={() => { setCheckinModal(false); setCheckinAnswers({}); }}
        title="Quick check-in"
        description="Just today's — takes under a minute."
        size="sm"
        footer={<>
          <Button type="button" variant="secondary" onClick={() => { setCheckinModal(false); setCheckinAnswers({}); }}>Skip</Button>
          <Button type="button" disabled={Object.keys(checkinAnswers).length === 0 || savingCheckin} onClick={() => void saveCheckin()}>
            {savingCheckin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Done
          </Button>
        </>}
      >
        <div className="space-y-4">
          {checkinQuestions.map((q) => (
            <div key={q.key}>
              <label className="block text-sm font-medium mb-1.5">{q.label}</label>
              <div className="flex gap-1.5">
                {CHECKIN_SCALE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCheckinAnswers({ ...checkinAnswers, [q.key]: n })}
                    className={`flex-1 h-9 rounded-lg border text-sm font-medium ${checkinAnswers[q.key] === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Low</span><span>High</span>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Period Summary (spec Phase 21 "Weekly AI Review" + Phase 22
          "Monthly Journey Review" — same shape, toggled window) —
          arithmetic over already-loaded activities/milestones, not an LLM
          call; every line traces to a real count, per this file's "never
          present a weak signal as fact" rule applied consistently. */}
      <Modal open={weeklyReviewOpen} onClose={() => setWeeklyReviewOpen(false)} title="Your journey" size="sm"
        footer={<Button type="button" variant="secondary" onClick={() => setWeeklyReviewOpen(false)}>Close</Button>}>
        <div className="space-y-4">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setReviewWindowDays(7)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${reviewWindowDays === 7 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>Week</button>
            <button type="button" onClick={() => setReviewWindowDays(30)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${reviewWindowDays === 30 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>Month</button>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Wins</p>
            {periodSummary.wins.length > 0 ? (
              <ul className="space-y-1">
                {periodSummary.wins.map((w, i) => <li key={i} className="text-sm flex items-start gap-1.5"><Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> {w}</li>)}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing logged yet in this period.</p>}
          </div>
          {periodSummary.challenges.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Opportunity</p>
              <ul className="space-y-1">
                {periodSummary.challenges.map((c, i) => <li key={i} className="text-sm text-muted-foreground">{c}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Personalization level</p>
            <p className="text-sm">{personalizationLevel}/5 — {PERSONALIZATION_LEVEL_LABELS[personalizationLevel]}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {periodSummary.totalLogged} activit{periodSummary.totalLogged === 1 ? "y" : "ies"} logged in the last {periodSummary.windowDays} days.
          </p>
        </div>
      </Modal>

      {/* AI Reflection (spec Phase 12) — shown once, right after a
          milestone is newly detected. Skippable; a milestone is real
          whether or not this is answered. */}
      <Modal
        open={!!reflectionMilestone}
        onClose={() => { setReflectionMilestone(null); setReflectionText(""); }}
        title={reflectionMilestone ? `${MILESTONE_COPY[reflectionMilestone.milestone_type]?.icon} ${MILESTONE_COPY[reflectionMilestone.milestone_type]?.label}` : "Milestone"}
        description="What worked? What was difficult? (Optional)"
        size="sm"
        footer={<>
          <Button type="button" variant="secondary" onClick={() => { setReflectionMilestone(null); setReflectionText(""); }}>Skip</Button>
          <Button type="button" disabled={!reflectionText.trim() || savingReflection} onClick={() => void saveReflection()}>
            {savingReflection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </Button>
        </>}
      >
        <textarea
          value={reflectionText}
          onChange={(e) => setReflectionText(e.target.value)}
          rows={3}
          placeholder="e.g. Morning workouts worked better than evenings for me"
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
        />
      </Modal>
    </div>
  );
}
