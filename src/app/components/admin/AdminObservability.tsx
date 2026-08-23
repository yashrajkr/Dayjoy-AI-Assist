import { useEffect, useState } from "react";
import { Activity, Gauge, ShieldAlert, ThumbsDown, ThumbsUp, Timer } from "lucide-react";
import { PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import { BarChart, DonutChart, type BarChartItem, type DonutSlice } from "../common/Charts";
import {
  adminObservability,
  adminFeedbackSummary,
  type AdminObservability as ObservabilityData,
  type AdminFeedbackSummary,
} from "../../../lib/api";

/**
 * Observability Dashboard — Advanced Intelligence Layer capability 18.
 *
 * Reads two existing, already-tested admin endpoints (backend/admin_api.py):
 * GET /admin/analytics/observability (request volume, latency, confidence,
 * routing/mode distribution — from the EXISTING `analytics` table, extended
 * by database/supabase_schema_v27_analytics_observability.sql) and
 * GET /admin/analytics/feedback-summary (👍/👎 aggregation, added the same
 * session as this page). Neither is a new metrics pipeline — this page is
 * purely the missing UI over data the backend already collects.
 */
export function AdminObservability() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [obs, setObs] = useState<ObservabilityData | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedbackSummary | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [o, f] = await Promise.all([adminObservability(days), adminFeedbackSummary()]);
        if (!cancelled) {
          setObs(o);
          setFeedback(f);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load observability data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const categoryBars: BarChartItem[] = obs
    ? Object.entries(obs.by_category)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, value]) => ({ label, value }))
    : [];

  const routeSlices: DonutSlice[] = obs
    ? Object.entries(obs.by_answer_route)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([label, value], i) => ({
          label,
          value,
          color: ["var(--primary)", "var(--secondary)", "var(--gold-accent)", "var(--warning)", "var(--destructive)", "var(--muted-foreground)"][i % 6],
        }))
    : [];

  const modeBars: BarChartItem[] = obs?.by_ai_mode
    ? Object.entries(obs.by_ai_mode)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value }))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Observability"
        description="Response-intelligence pipeline health: request volume, latency, grounding confidence, routing decisions, and user feedback."
        icon={<Activity className="w-5 h-5" aria-hidden="true" />}
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            aria-label="Time window"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        }
      />

      {loading ? <LoadingState label="Loading observability data…" /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error && obs ? (
        <>
          {!obs.migration_applied ? (
            <Card className="border-warning/30 bg-gold-accent/5 px-4 py-3 text-sm text-warning">
              Latency, confidence, and AI-mode breakdowns require the
              database/supabase_schema_v27_analytics_observability.sql
              migration — apply it to see the full dashboard. Request/
              category/routing counts below are already live.
            </Card>
          ) : null}

          {obs.total_requests === 0 ? (
            <EmptyState
              title="No requests in this window"
              description="Once chat traffic comes in, request volume, routing, and quality metrics will appear here."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total requests" value={obs.total_requests} icon={<Activity className="w-4 h-4" aria-hidden="true" />} />
                <StatCard
                  label="Safety blocks"
                  value={obs.blocked_requests}
                  hint={obs.safety_block_rate != null ? `${(obs.safety_block_rate * 100).toFixed(1)}% of requests` : undefined}
                  icon={<ShieldAlert className="w-4 h-4" aria-hidden="true" />}
                />
                <StatCard
                  label="Avg confidence"
                  value={obs.avg_confidence != null ? obs.avg_confidence.toFixed(2) : "—"}
                  icon={<Gauge className="w-4 h-4" aria-hidden="true" />}
                />
                <StatCard
                  label="Avg / p95 latency"
                  value={obs.avg_latency_ms != null ? `${Math.round(obs.avg_latency_ms)}ms` : "—"}
                  hint={obs.p95_latency_ms != null ? `p95: ${Math.round(obs.p95_latency_ms)}ms` : undefined}
                  icon={<Timer className="w-4 h-4" aria-hidden="true" />}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Requests by category</h3>
                  <BarChart data={categoryBars} horizontal />
                </Card>
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Answer routing</h3>
                  <div className="flex justify-center">
                    <DonutChart data={routeSlices} centerLabel="Requests" centerValue={obs.total_requests} />
                  </div>
                </Card>
              </div>

              {modeBars.length > 0 ? (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Requests by AI mode</h3>
                  <BarChart data={modeBars} />
                </Card>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {!loading && feedback ? (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">User feedback</h3>
          {feedback.total_rated === 0 ? (
            <EmptyState title="No feedback yet" description="👍/👎 ratings on chat answers will summarize here." />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Rated responses" value={feedback.total_rated} />
                <StatCard label="Helpful" value={feedback.total_up} icon={<ThumbsUp className="w-4 h-4" aria-hidden="true" />} />
                <StatCard label="Not helpful" value={feedback.total_down} icon={<ThumbsDown className="w-4 h-4" aria-hidden="true" />} />
              </div>
              {feedback.recent_negative_comments.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Recent negative feedback</p>
                  <ul className="space-y-2">
                    {feedback.recent_negative_comments.slice(0, 5).map((c, i) => (
                      <li key={i} className="text-sm rounded-lg border border-border bg-accent/20 px-3 py-2">
                        <span className="text-muted-foreground">{c.answer_source ?? "unknown"} · {c.ai_mode ?? "normal"}:</span>{" "}
                        {c.feedback_comment}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
