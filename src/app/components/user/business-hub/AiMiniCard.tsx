import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { biAsk } from "../../../../lib/api";
import { Section } from "../BusinessIntelligence";
import { Button } from "../../ui/button";

/**
 * A compact "ask AI about this section" card — reused across every Business
 * Hub page so each section has a grounded AI assistant without duplicating
 * the Ask-AI chat implementation (that full experience lives in
 * BusinessIntelligence's AskAiCard). This variant is single-shot: it asks
 * one question against the same /distributor/bi/ask endpoint (real data,
 * same LLM), shows the answer inline, and lets the user ask a follow-up.
 */
export function AiMiniCard({ title = "AI Assistant", prompts }: { title?: string; prompts: string[] }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const ask = async (q: string) => {
    if (!q.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await biAsk(q);
      setAnswer(res.answer);
    } catch {
      setAnswer("Sorry, I couldn't process that just now. Please try again.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <Section title={title} icon={<Bot className="w-4 h-4 text-primary" />}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => { setQuestion(p); ask(p); }}
            className="text-[11px] px-2.5 py-1.5 rounded-full border border-border hover:bg-accent/60 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
      {asking ? <p className="text-xs text-muted-foreground py-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 animate-pulse" /> Thinking…</p> : null}
      {answer ? <p className="text-sm bg-accent/40 rounded-xl px-3 py-2.5 whitespace-pre-wrap">{answer}</p> : null}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="flex items-center gap-2 mt-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a follow-up…"
          className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" size="sm" disabled={asking || !question.trim()}>Ask</Button>
      </form>
    </Section>
  );
}
