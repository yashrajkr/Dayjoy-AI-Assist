import { useCallback, useEffect, useState } from "react";
import { ListChecks, X } from "lucide-react";
import { distributorListSuggestions, distributorDismissSuggestion } from "../../../../../lib/api";
import { LoadingState, ErrorState, EmptyState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { AiMiniCard } from "../AiMiniCard";

type Suggestion = { id: string; title: string; body: string; priority: string; action_label?: string | null; action_url?: string | null };

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "border-destructive/40 bg-destructive/5 text-destructive",
  high: "border-warning/40 bg-warning/5 text-warning",
  normal: "border-primary/30 bg-primary/5 text-primary",
  low: "border-border bg-accent/20 text-muted-foreground",
};

export function TasksPage() {
  const [tasks, setTasks] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks((await distributorListSuggestions(30)) as unknown as Suggestion[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (id: string) => {
    await distributorDismissSuggestion(id);
    setTasks((t) => t.filter((x) => x.id !== id));
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading your tasks…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" /> Tasks</h1>
      <p className="text-xs text-muted-foreground">AI-generated action items from your business activity — training reminders, follow-up nudges, and goal check-ins.</p>

      <AiMiniCard title="AI Task Prioritizer" prompts={["Which task should I do first today?"]} />

      {tasks.length === 0 ? (
        <EmptyState title="No open tasks — Dayjoy AI will surface action items here as your business activity generates them." />
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 ${PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.normal}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-xs opacity-80 mt-0.5">{t.body}</p>
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="shrink-0 p-1 rounded hover:bg-black/10" aria-label="Dismiss task">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
