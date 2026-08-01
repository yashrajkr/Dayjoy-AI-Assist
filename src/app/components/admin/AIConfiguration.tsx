import { useCallback, useEffect, useState } from "react";
import {
  Brain, Save, RotateCcw, Loader2, CheckCircle2, Sliders, MessageSquare,
  Shield, Database, Zap, Thermometer, Hash,
} from "lucide-react";
import {
  PageHeader, Card, LoadingState, ErrorState, btnClass,
} from "../common/AdminUI";
import { Input } from "../ui/input";
import { Modal, modalButtonClass } from "../common/Modal";
import {
  adminGetAIConfig, adminUpdateAIConfig, adminGetSafetyRules, adminUpdateSafetyRule,
  type AIConfig,
} from "../../../lib/api";
import { BRAND } from "../../lib/brand";

export function AIConfiguration() {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [safetyRules, setSafetyRules] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, rules] = await Promise.all([
        adminGetAIConfig().catch(() => null),
        adminGetSafetyRules().catch(() => []),
      ]);
      if (cfg) setConfig(cfg);
      else {
        // Fallback to env defaults
        setConfig({
          groq_model: "llama-3.3-70b-versatile",
          openai_model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 800,
          streaming_enabled: true,
          system_prompt: `You are ${BRAND.name} AI Assist...`,
          fallback_message: "I don't have enough approved information to answer that safely.",
          confidence_floor: 0.55,
          handoff_threshold: 0.4,
          top_k: 5,
          min_similarity: 0.2,
          memory_enabled: true,
          max_history_turns: 6,
          supported_languages: ["en", "hi"],
          default_language: "en",
        });
      }
      setSafetyRules(rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (patch: Partial<AIConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...patch } : prev);
    setSaved(false);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminUpdateAIConfig(config);
      setConfig(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleSafetyRule = async (ruleId: string, enabled: boolean) => {
    try {
      await adminUpdateSafetyRule(ruleId, { enabled });
      setSafetyRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    }
  };

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="AI Configuration" icon={<Brain className="w-5 h-5" />} />
      <LoadingState label="Loading AI configuration…" />
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="AI Configuration"
        description="Configure the LLM model, prompt, safety rules, and retrieval settings used by the AI assistant."
        icon={<Brain className="w-5 h-5" />}
        actions={
          <>
            <button type="button" className={btnClass.secondary} onClick={() => setResetOpen(true)}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset
            </button>
            <button
              type="button"
              className={btnClass.primary}
              onClick={save}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
              {saved ? "Saved!" : "Save changes"}
            </button>
          </>
        }
      />

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}
      {saved ? (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          Configuration saved. New values apply to the next AI request.
        </div>
      ) : null}

      {config ? (
        <div className="space-y-4">
          {/* LLM Provider */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">LLM Provider</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Groq Model" icon={<Hash className="w-3 h-3" />}>
                <Input
                  type="text"
                  value={config.groq_model ?? ""}
                  onChange={(e) => update({ groq_model: e.target.value })}
                  className="w-full px-3 py-2 h-auto rounded-lg"
                  placeholder="llama-3.3-70b-versatile"
                />
              </Field>
              <Field label="OpenAI Model (fallback)" icon={<Hash className="w-3 h-3" />}>
                <Input
                  type="text"
                  value={config.openai_model ?? ""}
                  onChange={(e) => update({ openai_model: e.target.value })}
                  className="w-full px-3 py-2 h-auto rounded-lg"
                  placeholder="gpt-4o-mini"
                />
              </Field>
              <Field label={`Temperature: ${config.temperature?.toFixed(2)}`} icon={<Thermometer className="w-3 h-3" />}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={config.temperature ?? 0.2}
                  onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0 (deterministic)</span>
                  <span>2 (creative)</span>
                </div>
              </Field>
              <Field label={`Max Tokens: ${config.max_tokens}`}>
                <input
                  type="range"
                  min={100}
                  max={4000}
                  step={100}
                  value={config.max_tokens ?? 800}
                  onChange={(e) => update({ max_tokens: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>100</span>
                  <span>4000</span>
                </div>
              </Field>
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm">
              <input
                type="checkbox"
                checked={config.streaming_enabled ?? true}
                onChange={(e) => update({ streaming_enabled: e.target.checked })}
                className="rounded"
              />
              Enable streaming responses (SSE)
            </label>
          </Card>

          {/* Prompt */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">System Prompt & Fallback</h2>
            </div>
            <Field label="System Prompt" hint="The base instruction given to the AI before any user message.">
              <textarea
                value={config.system_prompt ?? ""}
                onChange={(e) => update({ system_prompt: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              />
            </Field>
            <Field label="Fallback Message" hint="Shown when the AI cannot answer from approved knowledge.">
              <textarea
                value={config.fallback_message ?? ""}
                onChange={(e) => update({ fallback_message: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
          </Card>

          {/* RAG Settings */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">RAG Retrieval Settings</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={`Confidence Floor: ${((config.confidence_floor ?? 0.55) * 100).toFixed(0)}%`} hint="Above this → 'verified'">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.confidence_floor ?? 0.55}
                  onChange={(e) => update({ confidence_floor: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Handoff Threshold: ${((config.handoff_threshold ?? 0.4) * 100).toFixed(0)}%`} hint="Below this → support ticket">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.handoff_threshold ?? 0.4}
                  onChange={(e) => update({ handoff_threshold: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Top K: ${config.top_k ?? 5}`} hint="Number of chunks retrieved per query">
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={config.top_k ?? 5}
                  onChange={(e) => update({ top_k: parseInt(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Min Similarity: ${(config.min_similarity ?? 0.2).toFixed(2)}`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.min_similarity ?? 0.2}
                  onChange={(e) => update({ min_similarity: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </Field>
            </div>
          </Card>

          {/* Memory & Languages */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Sliders className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Memory & Languages</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.memory_enabled ?? true}
                  onChange={(e) => update({ memory_enabled: e.target.checked })}
                  className="rounded"
                />
                Enable conversation memory
              </label>
              <Field label={`Max History Turns: ${config.max_history_turns ?? 6}`}>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={config.max_history_turns ?? 6}
                  onChange={(e) => update({ max_history_turns: parseInt(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label="Default Language">
                <select
                  value={config.default_language ?? "en"}
                  onChange={(e) => update({ default_language: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                  <option value="kn">Kannada</option>
                  <option value="mr">Marathi</option>
                  <option value="bn">Bengali</option>
                </select>
              </Field>
              <Field label="Supported Languages" hint="Comma-separated ISO codes">
                <Input
                  type="text"
                  value={(config.supported_languages ?? ["en"]).join(", ")}
                  onChange={(e) => update({ supported_languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 h-auto rounded-lg"
                />
              </Field>
            </div>
          </Card>

          {/* Safety Rules */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Safety Rules</h2>
              <span className="text-xs text-muted-foreground ml-auto">{safetyRules.length} rules</span>
            </div>
            {safetyRules.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No safety rules configured. Default rules apply.
              </p>
            ) : (
              <div className="space-y-2">
                {safetyRules.map((rule) => (
                  <div key={String(rule.id)} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium font-mono">{String(rule.rule_key ?? "—")}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{String(rule.pattern ?? "")}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase">{String(rule.action ?? "block")}</span>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={rule.enabled !== false}
                        onChange={(e) => toggleSafetyRule(String(rule.id), e.target.checked)}
                        className="rounded"
                      />
                      {rule.enabled !== false ? "Enabled" : "Disabled"}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset to defaults?"
        description="This will discard your unsaved changes and reload the current configuration from the server."
        size="sm"
        footer={
          <>
            <button type="button" className={modalButtonClass.secondary} onClick={() => setResetOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={modalButtonClass.primary}
              onClick={() => {
                setResetOpen(false);
                load();
              }}
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reload
            </button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Any unsaved changes will be lost. Saved changes are not affected.
        </p>
      </Modal>
    </div>
  );
}

function Field({
  label, hint, icon, children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </label>
      {children}
      {hint ? <p className="text-[10px] text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}
