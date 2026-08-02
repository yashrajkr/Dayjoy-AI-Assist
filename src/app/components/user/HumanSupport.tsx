import { useState } from "react";
import { LifeBuoy, Send, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Card } from "../ui/card";

const CATEGORIES = [
  "Product question",
  "Order / delivery",
  "Refund / return",
  "Distributor onboarding",
  "Account / login",
  "Other",
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

export function HumanSupport() {
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!supabase) {
        setError("Support tickets require Supabase. Contact Dayjoy support directly.");
        return;
      }
      const { error: err } = await supabase.from("support_tickets").insert({
        user_id: currentUser?.id ?? null,
        query: query.trim(),
        issue_category: category,
        priority,
        status: "open",
      });
      if (err) throw err;
      setSubmitted(true);
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto">
        <Card className="border-primary/30 surface-gradient p-8 text-center shadow-none">
          <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-3" aria-hidden="true" />
          <h1 className="text-xl font-semibold mb-1">Ticket submitted</h1>
          <p className="text-sm text-muted-foreground mb-4">
            A Dayjoy support team member will follow up shortly. You can track progress in the
            Support Tickets page of the admin console.
          </p>
          <Button type="button" onClick={() => setSubmitted(false)}>
            Submit another ticket
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <LifeBuoy className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">Human Support</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Can't find what you need from {BRAND.name}? Raise a ticket and a Dayjoy team member will
          respond directly.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="dj-support-query" className="block text-xs font-medium text-muted-foreground mb-1">
            What do you need help with?
          </label>
          <Textarea
            id="dj-support-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={5}
            maxLength={2000}
            required
            placeholder="Describe your question or issue in as much detail as you can…"
            className="w-full rounded-xl bg-card resize-y focus-visible:ring-4 focus-visible:ring-primary/10"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="dj-support-category" className="block text-xs font-medium text-muted-foreground mb-1">
              Category
            </label>
            <select
              id="dj-support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dj-support-priority" className="block text-xs font-medium text-muted-foreground mb-1">
              Priority
            </label>
            <select
              id="dj-support-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" disabled={submitting || !query.trim()} className="rounded-xl">
          <Send className="w-4 h-4" aria-hidden="true" />
          {submitting ? "Submitting…" : "Raise support ticket"}
        </Button>
      </form>

      <Card className="mt-6 p-4">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Prefer to talk to someone?</strong>
          <br />
          Dayjoy Support: <a href="tel:+918000000000" className="text-primary hover:underline">+91 80000 00000</a>
          {" · "}
          <a href="mailto:support@dayjoy.com" className="text-primary hover:underline">support@dayjoy.com</a>
        </p>
      </Card>
    </div>
  );
}
