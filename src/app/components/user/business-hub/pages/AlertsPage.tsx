import { useCallback, useEffect, useState } from "react";
import { Bell, PhoneCall, ClipboardList, CalendarClock, Cake, ShieldCheck } from "lucide-react";
import { biAlerts, biReminders, type BiReminder } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";
import { useNavigate } from "react-router-dom";

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-destructive/40 bg-destructive/5 text-destructive",
  medium: "border-warning/40 bg-warning/5 text-warning",
  low: "border-primary/30 bg-primary/5 text-primary",
};

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

export function AlertsPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Array<{ type: string; severity: "low" | "medium" | "high"; message: string }>>([]);
  const [reminders, setReminders] = useState<BiReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [al, rem] = await Promise.all([biAlerts(), biReminders()]);
      setAlerts(al.alerts);
      setReminders(rem.reminders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your alerts…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Bell className="w-5 h-5 text-primary" /> Alerts</h1>

      <Section title="Smart Alerts" icon={<Bell className="w-4 h-4 text-primary" />}>
        {alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No alerts — everything looks healthy.</p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i} className={`text-xs px-2.5 py-2 rounded-lg border ${SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.low}`}>{a.message}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Reminders" icon={<CalendarClock className="w-4 h-4 text-primary" />}>
        {reminders.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Nothing needs your attention right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {reminders.map((r, i) => (
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
    </div>
  );
}
