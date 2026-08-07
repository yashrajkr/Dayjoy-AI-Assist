import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Video, MapPin } from "lucide-react";
import { distributorListEvents } from "../../../../../lib/api";
import { LoadingState, ErrorState, EmptyState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { AiMiniCard } from "../AiMiniCard";

type EventRow = { id: string; title: string; event_type: string; start_time: string; location?: string | null; meeting_url?: string | null };

export function MeetingsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents((await distributorListEvents(50)) as unknown as EventRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Loading upcoming meetings…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" /> Meetings</h1>

      <AiMiniCard title="AI Schedule Assistant" prompts={["What should I prepare for my next meeting?"]} />

      {events.length === 0 ? (
        <EmptyState title="No upcoming meetings, webinars, or trainings scheduled." />
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{e.title}</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-border capitalize">{e.event_type}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{new Date(e.start_time).toLocaleString()}</span>
                {e.location ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {e.location}</span> : null}
                {e.meeting_url ? <a href={e.meeting_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary"><Video className="w-3 h-3" /> Join</a> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
