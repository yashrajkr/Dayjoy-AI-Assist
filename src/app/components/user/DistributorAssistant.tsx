import { useState } from "react";
import { MessageSquare, Copy, Sparkles, Send, Instagram, CalendarCheck, Check } from "lucide-react";
import { logAnalytics } from "../../lib/db";
import { useAuth } from "../../lib/AuthContext";
import { streamChatWithBackend } from "../../../lib/api";
import { BRAND } from "../../lib/brand";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Card } from "../ui/card";

type Tone = "Professional" | "Friendly" | "Hinglish" | "Short WhatsApp reply";

const TOOLS = [
  {
    id: "objection",
    icon: MessageSquare,
    title: "Objection Handling",
    placeholder: "Customer says the product is too costly…",
    systemHint: "Generate an ethical response to this customer objection. Use approved product knowledge.",
  },
  {
    id: "followup",
    icon: Send,
    title: "Follow-up Generator",
    placeholder: "Customer name, product, last conversation…",
    systemHint: "Generate a polite follow-up message to a customer.",
  },
  {
    id: "social",
    icon: Instagram,
    title: "Social Post Generator",
    placeholder: "Product name and the social platform…",
    systemHint: "Generate a compliant social media post about a Dayjoy product. No medical or income claims.",
  },
  {
    id: "plan",
    icon: CalendarCheck,
    title: "Daily Routine Planner",
    placeholder: "Your goal for today (e.g. 5 new prospects)…",
    systemHint: "Generate a structured daily routine for a Dayjoy distributor.",
  },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

export function DistributorAssistant() {
  const { role } = useAuth();
  const [tone, setTone] = useState<Tone>("Professional");
  const [inputs, setInputs] = useState<Record<ToolId, string>>({
    objection: "",
    followup: "",
    social: "",
    plan: "",
  });
  const [outputs, setOutputs] = useState<Record<ToolId, string>>({
    objection: "",
    followup: "",
    social: "",
    plan: "",
  });
  const [loading, setLoading] = useState<Record<ToolId, boolean>>({
    objection: false,
    followup: false,
    social: false,
    plan: false,
  });
  const [copied, setCopied] = useState<ToolId | null>(null);

  const generate = async (tool: typeof TOOLS[number]) => {
    const value = inputs[tool.id].trim();
    if (!value || loading[tool.id]) return;
    setLoading((prev) => ({ ...prev, [tool.id]: true }));
    setOutputs((prev) => ({ ...prev, [tool.id]: "" }));

    let aggregated = "";
    try {
      await streamChatWithBackend(
        {
          message: `${tool.systemHint}\n\nTone: ${tone}\nInput: ${value}`,
          role: role ?? "distributor",
          language: "English",
        },
        (chunk) => {
          aggregated += chunk;
          setOutputs((prev) => ({ ...prev, [tool.id]: aggregated }));
        },
      );
      if (!aggregated) {
        setOutputs((prev) => ({
          ...prev,
          [tool.id]: "Unable to generate a response right now. Please try again.",
        }));
      }
      void logAnalytics({
        user_id: null,
        role: "distributor",
        language: null,
        query: `${tool.title}::${value.slice(0, 200)}`,
        category: null,
        source_used: "distributor_assistant",
        safety_status: "safe",
      });
    } catch (e) {
      setOutputs((prev) => ({
        ...prev,
        [tool.id]: `Error: ${e instanceof Error ? e.message : "generation failed"}`,
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const copyOutput = async (tool: ToolId) => {
    if (!outputs[tool]) return;
    try {
      await navigator.clipboard.writeText(outputs[tool]);
      setCopied(tool);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    // No h-full/overflow-y-auto here: this component is rendered both inside
    // BusinessHubShell (which already owns the scroll container — nesting
    // another one here forced content to stretch to a min-h-full ancestor
    // and left a large blank scrollable gap below short content) and
    // standalone at /distributor (see App.tsx, which wraps it in its own
    // scroll container there instead).
    <div className="bg-background p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">
            {BRAND.shortName} / Distributor Mode
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Distributor Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Generate ethical replies, follow-ups, sales scripts, and social posts — without unsafe medical or income claims.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="dj-dist-tone" className="text-xs text-muted-foreground">
            Tone:
          </label>
          <select
            id="dj-dist-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option>Professional</option>
            <option>Friendly</option>
            <option>Hinglish</option>
            <option>Short WhatsApp reply</option>
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Card
                key={tool.id}
                className="p-5 shadow-flat hover-raise flex flex-col"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="text-lg font-semibold">{tool.title}</h2>
                </div>
                <label htmlFor={`dj-dist-input-${tool.id}`} className="sr-only">
                  {tool.title} input
                </label>
                <Textarea
                  id={`dj-dist-input-${tool.id}`}
                  className="w-full min-h-24 rounded-xl bg-background focus-visible:ring-4 focus-visible:ring-primary/10"
                  placeholder={tool.placeholder}
                  value={inputs[tool.id]}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [tool.id]: e.target.value }))
                  }
                  maxLength={1000}
                />
                <Button
                  type="button"
                  className="mt-3 rounded-xl"
                  onClick={() => generate(tool)}
                  disabled={!inputs[tool.id].trim() || loading[tool.id]}
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  {loading[tool.id] ? "Generating…" : "Generate"}
                </Button>
                {outputs[tool.id] ? (
                  <div className="ai-prose mt-4 bg-background border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Suggested output
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => copyOutput(tool.id)}
                        className="h-auto w-auto p-1 text-muted-foreground"
                        aria-label="Copy output"
                      >
                        {copied === tool.id ? (
                          <Check className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{outputs[tool.id]}</p>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>

        <Card className="border-warning/30 bg-warning/5 p-5 shadow-none">
          <h3 className="font-semibold text-warning mb-1">Compliance reminder</h3>
          <p className="text-sm text-warning/90">
            Do not claim cure, treatment, guaranteed result, or guaranteed income.
            Use approved product knowledge and escalate to human support for risky questions.
          </p>
        </Card>
      </div>
    </div>
  );
}
