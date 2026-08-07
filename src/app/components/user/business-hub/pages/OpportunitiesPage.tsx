import { useCallback, useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { distributorListCustomers, type CustomerProfile } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { KpiCard, Section } from "../../BusinessIntelligence";
import { AiMiniCard } from "../AiMiniCard";
import { useNavigate } from "react-router-dom";

export function OpportunitiesPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await distributorListCustomers({ limit: 500 });
      setCustomers(res.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Finding opportunities…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;

  const leads = customers.filter((c) => c.status === "lead");
  const prospects = customers.filter((c) => c.status === "prospect");
  const vip = customers.filter((c) => c.status === "vip");

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Lightbulb className="w-5 h-5 text-primary" /> Opportunities</h1>
      <p className="text-xs text-muted-foreground">Conversion opportunities derived from your real customer pipeline.</p>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Leads to convert" value={leads.length} icon={<Lightbulb className="w-4 h-4" />} />
        <KpiCard label="Prospects to close" value={prospects.length} icon={<Lightbulb className="w-4 h-4" />} />
        <KpiCard label="VIP to upsell" value={vip.length} icon={<Lightbulb className="w-4 h-4" />} />
      </div>

      <AiMiniCard
        title="AI Opportunity Finder"
        prompts={["Which lead should I follow up with first?", "What can I upsell to my VIP customers?"]}
      />

      <Section title="Leads & Prospects" icon={<Lightbulb className="w-4 h-4 text-primary" />}>
        {leads.length + prospects.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No open leads or prospects right now — add customers to start tracking opportunities.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...leads, ...prospects].slice(0, 20).map((c, i) => (
              <li
                key={c.id || i}
                className="flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent/30 cursor-pointer"
                onClick={() => navigate("/distributor/customers")}
              >
                <span className="truncate">{c.full_name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-border capitalize">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
