import { useCallback, useEffect, useState } from "react";
import { Shield, RefreshCw, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  StatusPill,
  btnClass,
} from "../common/AdminUI";

type SafetyRule = {
  id: string;
  rule_key: string;
  description: string | null;
  pattern: string | null;
  action: string | null;
  enabled: boolean;
  severity: string | null;
  updated_at: string | null;
};

export function AISafetyRules() {
  const [rules, setRules] = useState<SafetyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const { data, error: err } = await supabase
        .from("safety_rules")
        .select("*")
        .order("severity", { ascending: false })
        .order("rule_key", { ascending: true });
      if (err) throw err;
      setRules((data ?? []) as SafetyRule[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load safety rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (r: SafetyRule) => {
    if (!supabase) return;
    setSavingId(r.id);
    try {
      const next = !r.enabled;
      const { error: err } = await supabase
        .from("safety_rules")
        .update({ enabled: next })
        .eq("id", r.id);
      if (err) throw err;
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="AI Safety Rules"
        description="Guardrails that block unsafe content before it reaches the AI model."
        icon={<Shield className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        }
      />

      <Card className="mb-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium">Defense in depth</p>
            <p className="text-muted-foreground mt-0.5">
              These rules run on the FastAPI backend before the LLM is called. Even if a rule is
              disabled, the LLM system prompt repeats the same guidance. Audit logs capture every
              block action.
            </p>
          </div>
        </div>
      </Card>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading safety rules…" />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            title="No safety rules configured"
            description="Run supabase_schema_v2.sql to seed the default rules."
            icon={<Shield className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono font-medium">{r.rule_key}</code>
                    <StatusPill status={r.severity ?? "medium"} />
                    {r.action ? <StatusPill status={r.action} /> : null}
                  </div>
                  {r.description ? (
                    <p className="text-sm text-muted-foreground">{r.description}</p>
                  ) : null}
                  {r.pattern ? (
                    <pre className="text-xs text-muted-foreground mt-2 font-mono bg-accent/30 px-2 py-1 rounded">
                      {r.pattern}
                    </pre>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  disabled={savingId === r.id}
                  className={btnClass.secondary}
                  aria-pressed={r.enabled}
                  aria-label={r.enabled ? `Disable ${r.rule_key}` : `Enable ${r.rule_key}`}
                >
                  {r.enabled ? (
                    <ToggleRight className="w-4 h-4 text-primary" aria-hidden="true" />
                  ) : (
                    <ToggleLeft className="w-4 h-4" aria-hidden="true" />
                  )}
                  {r.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
