import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, TrendingUp, TrendingDown, Users, Award, Target, Calendar,
  Send, AlertTriangle, ShieldCheck, Gift, Activity,
  Bot, ArrowUp, ArrowDown, Minus, UserPlus, ClipboardList, FileText,
  BarChart3, GraduationCap, MessageCircle, Trophy, Bell, Network, HeartHandshake, Rocket, Cake, CalendarClock, PhoneCall,
} from "lucide-react";
import {
  biOverview, biInsights, biAsk, biTimeline, biForecast, biTeamAnalytics,
  biAlerts, biGoalsProgress, biHealthBreakdown, biAchievements, biReminders,
  type BiOverview, type BiAchievements, type BiReminder,
} from "../../../lib/api";
import { LoadingState, ErrorState } from "../common/AdminUI";
import { LineChart, ProgressBar } from "../common/Charts";
import { Button } from "../ui/button";

const MOTIVATIONS = [
  "Small consistent actions compound into big results.",
  "Every follow-up you make today is a seed for tomorrow's income.",
  "Your network grows one honest conversation at a time.",
  "Consistency beats intensity — show up for your business today.",
  "The best time to reach out to a customer is right now.",
  "Great distributors are built one disciplined day at a time.",
  "Teach what you know — it's how leaders multiply themselves.",
];

function todaysMotivation(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return MOTIVATIONS[dayOfYear % MOTIVATIONS.length];
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

export function fmtInr(n: number | null | undefined): string {
  const v = Number(n || 0);
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function Section({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">{icon} {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, icon, trendPct }: { label: string; value: string | number; icon: React.ReactNode; trendPct?: number | null }) {
  const trendUp = typeof trendPct === "number" && trendPct > 0;
  const trendDown = typeof trendPct === "number" && trendPct < 0;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <div className="text-primary">{icon}</div>
      </div>
      <p className="text-lg font-semibold">{value}</p>
      {typeof trendPct === "number" ? (
        <p className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${trendUp ? "text-success" : trendDown ? "text-destructive" : "text-muted-foreground"}`}>
          {trendUp ? <ArrowUp className="w-2.5 h-2.5" /> : trendDown ? <ArrowDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
          {Math.abs(trendPct)}% vs last week
        </p>
      ) : null}
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background p-3 text-center hover:bg-accent/50 hover:border-primary/40 transition-colors"
    >
      <span className="text-primary">{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </button>
  );
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "border-destructive/40 bg-destructive/5 text-destructive",
  high: "border-warning/40 bg-warning/5 text-warning",
  normal: "border-primary/30 bg-primary/5 text-primary",
  low: "border-border bg-accent/20 text-muted-foreground",
};

const REMINDER_ICONS: Record<string, React.ReactNode> = {
  follow_up_overdue: <PhoneCall className="w-3.5 h-3.5" />,
  follow_up_due: <ClipboardList className="w-3.5 h-3.5" />,
  event: <CalendarClock className="w-3.5 h-3.5" />,
  birthday: <Cake className="w-3.5 h-3.5" />,
  kyc: <ShieldCheck className="w-3.5 h-3.5" />,
};

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-destructive/40 bg-destructive/5 text-destructive",
  medium: "border-warning/40 bg-warning/5 text-warning",
  low: "border-primary/30 bg-primary/5 text-primary",
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function BusinessIntelligence() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [insights, setInsights] = useState<string[] | null>(null);
  const [alerts, setAlerts] = useState<Array<{ type: string; severity: "low" | "medium" | "high"; message: string }>>([]);
  const [timeline, setTimeline] = useState<Array<{ type: string; title: string; timestamp: string }>>([]);
  const [forecast, setForecast] = useState<Awaited<ReturnType<typeof biForecast>> | null>(null);
  const [team, setTeam] = useState<Awaited<ReturnType<typeof biTeamAnalytics>> | null>(null);
  const [goals, setGoals] = useState<Awaited<ReturnType<typeof biGoalsProgress>> | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof biHealthBreakdown>> | null>(null);
  const [achievements, setAchievements] = useState<BiAchievements | null>(null);
  const [reminders, setReminders] = useState<{ reminders: BiReminder[]; overdue_count: number; due_soon_count: number; upcoming_events_count: number; birthdays_count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wowChange, setWowChange] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, ins, al, tl, fc, tm, gl, hb, ach, rem] = await Promise.all([
        biOverview(),
        biInsights().catch(() => ({ insights: [], generated_by: "computed", wow_change_pct: null })),
        biAlerts().catch(() => ({ alerts: [], count: 0 })),
        biTimeline(30).catch(() => ({ events: [] })),
        biForecast().catch(() => ({ has_enough_data: false, next_30_day_projection: null })),
        biTeamAnalytics().catch(() => null),
        biGoalsProgress().catch(() => null),
        biHealthBreakdown().catch(() => null),
        biAchievements().catch(() => null),
        biReminders().catch(() => null),
      ]);
      setOverview(ov);
      setInsights(ins.insights);
      setWowChange(ins.wow_change_pct ?? null);
      setAlerts(al.alerts);
      setTimeline(tl.events);
      setForecast(fc);
      setTeam(tm);
      setGoals(gl);
      setHealth(hb);
      setAchievements(ach);
      setReminders(rem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load business intelligence");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <LoadingState label="Loading your business intelligence…" />
    </div>
  );

  if (error) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <ErrorState message={error} />
      <Button onClick={load} className="mt-3">Retry</Button>
    </div>
  );

  if (!overview) return null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {/* Welcome header */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {timeGreeting()}{overview.distributor.full_name ? `, ${overview.distributor.full_name.split(" ")[0]}` : ""}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {overview.distributor.distributor_code ? `${overview.distributor.distributor_code} · ` : ""}
              {overview.distributor.sponsor_name ? `Sponsor: ${overview.distributor.sponsor_name}` : "Your Business Hub — everything about your business, in one place."}
            </p>
            <p className="text-xs text-primary/90 mt-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 shrink-0" /> {todaysMotivation()}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {overview.rank.current ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-accent/40 text-xs font-medium">
                <span>{overview.rank.badge_icon}</span> {overview.rank.current}
                {overview.rank.next ? <span className="text-muted-foreground">→ {overview.rank.next}</span> : null}
              </div>
            ) : null}
            {typeof overview.distributor.profile_completion_pct === "number" ? (
              <div className="w-40">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>Profile</span>
                  <span>{overview.distributor.profile_completion_pct}%</span>
                </div>
                <ProgressBar value={overview.distributor.profile_completion_pct} showLabel={false} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <Section title="Quick Actions" icon={<Rocket className="w-4 h-4 text-primary" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <QuickAction icon={<UserPlus className="w-4 h-4" />} label="Add Customer" onClick={() => navigate("/distributor/customers")} />
          <QuickAction icon={<ClipboardList className="w-4 h-4" />} label="Follow-up" onClick={() => navigate("/distributor/follow-ups")} />
          <QuickAction icon={<FileText className="w-4 h-4" />} label="Content" onClick={() => navigate("/distributor/content")} />
          <QuickAction icon={<Network className="w-4 h-4" />} label="Genealogy" onClick={() => navigate("/distributor/team")} />
          <QuickAction icon={<BarChart3 className="w-4 h-4" />} label="Analytics" onClick={() => navigate("/distributor/analytics")} />
          <QuickAction icon={<GraduationCap className="w-4 h-4" />} label="Training" onClick={() => navigate("/training")} />
          <QuickAction icon={<HeartHandshake className="w-4 h-4" />} label="Sales Coach" onClick={() => navigate("/distributor")} />
          <QuickAction icon={<MessageCircle className="w-4 h-4" />} label="Ask AI" onClick={() => document.getElementById("dj-ask-ai")?.scrollIntoView({ behavior: "smooth", block: "center" })} />
        </div>
      </Section>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <KpiCard label="Today's Sales" value={fmtInr(overview.today.sales_amount)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Today's BV" value={fmtInr(overview.today.business_volume)} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Today's Commission" value={fmtInr(overview.today.commission)} icon={<Gift className="w-4 h-4" />} />
        <KpiCard label="Today's Orders" value={overview.today.orders} icon={<Target className="w-4 h-4" />} />
        <KpiCard label="New Customers" value={overview.today.new_customers} icon={<Users className="w-4 h-4" />} />
        <KpiCard label="New Distributors" value={overview.today.new_distributors} icon={<Award className="w-4 h-4" />} />
        <KpiCard label="Weekly Business" value={fmtInr(overview.period.weekly_business)} icon={<TrendingUp className="w-4 h-4" />} trendPct={wowChange} />
        <KpiCard label="Monthly Business" value={fmtInr(overview.period.monthly_business)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Yearly Business" value={fmtInr(overview.period.yearly_business)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Active Team" value={overview.team.active} icon={<Users className="w-4 h-4" />} />
        <KpiCard label="Retention" value={`${overview.team.retention_pct}%`} icon={<ShieldCheck className="w-4 h-4" />} />
        <KpiCard label="Health Score" value={overview.business_health_score != null ? `${Math.round(overview.business_health_score)}/100` : "—"} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="AI Growth Score" value={`${overview.ai_growth_score}/100`} icon={<Sparkles className="w-4 h-4" />} />
        <KpiCard label="Achievement" value={`${overview.target.achievement_pct}%`} icon={<Target className="w-4 h-4" />} />
        <KpiCard label="Projected Income" value={fmtInr(overview.projected_income)} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Potential Incentive" value={fmtInr(overview.incentive.potential_value)} icon={<Gift className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Rank progress */}
        <Section title="Rank Progress" icon={<Award className="w-4 h-4 text-primary" />}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span>{overview.rank.current || "Distributor"}</span>
            <span className="text-muted-foreground">
              {overview.rank.next ? `Next: ${overview.rank.next}` : "Top rank achieved"}
            </span>
          </div>
          <ProgressBar value={overview.rank.progress_pct} showLabel />
          {overview.rank.next ? (
            <p className="text-[11px] text-muted-foreground mt-2">
              {fmtInr(overview.rank.bv_needed_for_next)} more trailing 90-day BV needed for {overview.rank.next}.
            </p>
          ) : null}
        </Section>

        {/* Monthly target */}
        <Section title="Monthly Target" icon={<Target className="w-4 h-4 text-primary" />}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span>{fmtInr(overview.target.month_to_date)} of {fmtInr(overview.target.monthly_target)}</span>
            <span className="text-muted-foreground">{overview.target.achievement_pct}%</span>
          </div>
          <ProgressBar value={overview.target.achievement_pct} showLabel={false} />
          {overview.incentive.current ? (
            <p className="text-[11px] text-success mt-2 flex items-center gap-1"><Gift className="w-3 h-3" /> Active incentive: {overview.incentive.current}</p>
          ) : null}
        </Section>
      </div>

      {/* AI Insights */}
      <Section title="AI Insights" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        {insights && insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground py-2">No insights yet — check back as your business activity grows.</p>
        )}
      </Section>

      {/* Ask AI */}
      <div id="dj-ask-ai">
        <AskAiCard />
      </div>

      {/* AI Reminder Center */}
      <Section
        title="AI Reminder Center"
        icon={<Bell className="w-4 h-4 text-primary" />}
        action={reminders ? <span className="text-[11px] text-muted-foreground">{reminders.reminders.length} active</span> : null}
      >
        {!reminders || reminders.reminders.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Nothing needs your attention right now.</p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {reminders.reminders.map((r, i) => (
              <li
                key={i}
                className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg border cursor-pointer hover:opacity-80 ${PRIORITY_STYLES[r.priority] || PRIORITY_STYLES.normal}`}
                onClick={() => navigate(r.action_url)}
              >
                <span className="shrink-0">{REMINDER_ICONS[r.type] || <Bell className="w-3.5 h-3.5" />}</span>
                <span className="flex-1 truncate">{r.title}</span>
                {r.due ? <span className="text-[10px] opacity-80 shrink-0">{new Date(r.due).toLocaleDateString()}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Smart Alerts */}
        <Section title="Smart Alerts" icon={<AlertTriangle className="w-4 h-4 text-primary" />}>
          {alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No alerts — everything looks healthy.</p>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map((a, i) => (
                <li key={i} className={`text-xs px-2.5 py-2 rounded-lg border ${SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.low}`}>
                  {a.message}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Business Timeline */}
        <Section title="Business Timeline" icon={<Calendar className="w-4 h-4 text-primary" />}>
          {timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No recent activity.</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {timeline.slice(0, 20).map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-accent/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="flex-1 truncate">{e.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{new Date(e.timestamp).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* AI Forecast */}
      <Section title="AI Forecast" icon={<TrendingUp className="w-4 h-4 text-primary" />}>
        {forecast?.has_enough_data ? (
          <div>
            <LineChart data={(forecast.daily_history || []).map((d) => ({ label: d.date, value: d.bv }))} height={180} />
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                Trend: {forecast.trend_direction === "up" ? <TrendingUp className="w-3.5 h-3.5 text-success" /> : forecast.trend_direction === "down" ? <TrendingDown className="w-3.5 h-3.5 text-destructive" /> : <Minus className="w-3.5 h-3.5" />}
                {forecast.trend_direction}
              </span>
              <span>Projected next 30 days: <strong className="text-foreground">{fmtInr(forecast.next_30_day_projection)}</strong></span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center">{forecast?.message || "Not enough data yet to forecast."}</p>
        )}
      </Section>

      {/* Team Analytics */}
      {team ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Top Leaders" icon={<Award className="w-4 h-4 text-primary" />}>
            {team.top_leaders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No active team members yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {team.top_leaders.slice(0, 6).map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-accent/30">
                    <span className="truncate">{String(m.member_name || "—")}</span>
                    <span className="font-medium">{fmtInr(Number(m.total_sales || 0))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Needs Support" icon={<AlertTriangle className="w-4 h-4 text-primary" />}>
            {team.needs_support.length === 0 && team.inactive_leaders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Your whole team is active and performing.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...team.inactive_leaders, ...team.needs_support].slice(0, 6).map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-accent/30">
                    <span className="truncate">{String(m.member_name || "—")}</span>
                    <span className="text-warning text-[10px]">needs attention</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      ) : null}

      {/* Business Health Score breakdown */}
      {health ? (
        <Section title="Business Health Score" icon={<Activity className="w-4 h-4 text-primary" />}>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-2xl font-semibold">{Math.round(health.overall_score)}<span className="text-sm text-muted-foreground">/100</span></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ["Sales", health.sales_score, 25],
              ["Follow-up Discipline", health.follow_up_score, 25],
              ["Customer Base", health.customer_score, 20],
              ["Training", health.training_score, 15],
              ["AI Usage", health.ai_usage_score, 15],
            ] as const).map(([label, score, max]) => (
              <div key={label}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">{score.toFixed(1)}/{max}</span>
                </div>
                <ProgressBar value={Math.round((score / max) * 100)} showLabel={false} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Achievements */}
      {achievements ? (
        <Section
          title="Achievements"
          icon={<Trophy className="w-4 h-4 text-primary" />}
          action={<span className="text-[11px] text-muted-foreground">{achievements.total_achievements} total</span>}
        >
          {achievements.rank_milestones.length === 0 && achievements.recognitions.length === 0 && achievements.achieved_goals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Your achievements will appear here as you hit rank milestones, earn recognition, and complete goals.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Rank Milestones</p>
                <ul className="space-y-1">
                  {achievements.rank_milestones.slice(0, 5).map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span>{m.badge_icon}</span>
                      <span className="flex-1 truncate">{m.rank_name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{m.achieved_at ? new Date(m.achieved_at).toLocaleDateString() : ""}</span>
                    </li>
                  ))}
                  {achievements.rank_milestones.length === 0 ? <li className="text-[11px] text-muted-foreground">None yet</li> : null}
                </ul>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Recognition Received</p>
                <ul className="space-y-1">
                  {achievements.recognitions.slice(0, 5).map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span>{String(r.badge_icon || "🏆")}</span>
                      <span className="flex-1 truncate">{String(r.title || "")}</span>
                    </li>
                  ))}
                  {achievements.recognitions.length === 0 ? <li className="text-[11px] text-muted-foreground">None yet</li> : null}
                </ul>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Goals Achieved</p>
                <ul className="space-y-1">
                  {achievements.achieved_goals.slice(0, 5).map((g, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <Target className="w-3 h-3 text-success shrink-0" />
                      <span className="flex-1 truncate capitalize">{String(g.category || g.goal_type || "goal")}</span>
                    </li>
                  ))}
                  {achievements.achieved_goals.length === 0 ? <li className="text-[11px] text-muted-foreground">None yet</li> : null}
                </ul>
              </div>
            </div>
          )}
        </Section>
      ) : null}

      {/* Goal Tracker */}
      {goals ? (
        <Section title="Smart Goal Tracker" icon={<Target className="w-4 h-4 text-primary" />}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(goals.periods).map(([period, g]) => (
              <div key={period}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="capitalize">{period}</span>
                  <span className="text-muted-foreground">{g.progress_pct != null ? `${g.progress_pct}%` : "no target set"}</span>
                </div>
                <ProgressBar value={g.progress_pct || 0} />
                <p className="text-[10px] text-muted-foreground mt-1">{fmtInr(g.actual)}{g.target ? ` / ${fmtInr(g.target)}` : ""}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask AI card
// ---------------------------------------------------------------------------

type ChatTurn = { role: "user" | "assistant"; content: string };

const SUGGESTED_QUESTIONS = [
  "How much did I earn today?",
  "Which of my team members need support?",
  "What should I do to reach my next rank?",
  "Generate today's work plan.",
];

function AskAiCard() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setSending(true);
    try {
      const res = await biAsk(question, sessionId.current);
      sessionId.current = res.session_id || sessionId.current;
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't process that just now. Please try again." }]);
    } finally {
      setSending(false);
    }
  }, [sending]);

  return (
    <Section title="Ask AI — Your Business Copilot" icon={<Bot className="w-4 h-4 text-primary" />}>
      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              className="text-[11px] px-2.5 py-1.5 rounded-full border border-border hover:bg-accent/60 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div ref={scrollRef} className="max-h-72 overflow-y-auto space-y-2 mb-3 pr-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent/50"}`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-accent/50 text-muted-foreground">Thinking…</div>
            </div>
          ) : null}
        </div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your business…"
          className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Send question">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </Section>
  );
}
