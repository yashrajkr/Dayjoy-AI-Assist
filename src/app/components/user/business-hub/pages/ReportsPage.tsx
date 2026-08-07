import { useCallback, useEffect, useState } from "react";
import { FileText, Download, Sparkles } from "lucide-react";
import { biOverview, biAsk, type BiOverview } from "../../../../../lib/api";
import { LoadingState, ErrorState } from "../../../common/AdminUI";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";

function downloadCsv(overview: BiOverview) {
  const rows = [
    ["Metric", "Value"],
    ["Distributor", overview.distributor.full_name || ""],
    ["Distributor Code", overview.distributor.distributor_code || ""],
    ["Rank", overview.rank.current || ""],
    ["Today's Sales", String(overview.today.sales_amount)],
    ["Today's BV", String(overview.today.business_volume)],
    ["Today's Commission", String(overview.today.commission)],
    ["Weekly Business", String(overview.period.weekly_business)],
    ["Monthly Business", String(overview.period.monthly_business)],
    ["Yearly Business", String(overview.period.yearly_business)],
    ["Team Total", String(overview.team.total)],
    ["Team Active", String(overview.team.active)],
    ["Retention %", String(overview.team.retention_pct)],
    ["Monthly Target", String(overview.target.monthly_target)],
    ["Achievement %", String(overview.target.achievement_pct)],
    ["Business Health Score", String(overview.business_health_score ?? "")],
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dayjoy-business-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await biOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateAiReport = async () => {
    setGenerating(true);
    setAiReport(null);
    try {
      const res = await biAsk("Generate a complete business report for me covering sales, team, rank progress, and recommendations for next month. Use headings.");
      setAiReport(res.answer);
    } catch {
      setAiReport("Couldn't generate the report right now — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingState label="Preparing report data…" /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorState message={error} /><Button onClick={load} className="mt-3">Retry</Button></div>;
  if (!overview) return null;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Reports</h1>

      <Section title="Export Business Data" icon={<Download className="w-4 h-4 text-primary" />}>
        <p className="text-xs text-muted-foreground mb-3">Download your current KPIs as a CSV file for offline records or sharing.</p>
        <Button size="sm" onClick={() => downloadCsv(overview)}><Download className="w-4 h-4 mr-1.5" /> Download CSV Report</Button>
      </Section>

      <Section title="AI-Generated Report" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        <p className="text-xs text-muted-foreground mb-3">Generate a written narrative report grounded in your real business data.</p>
        <Button size="sm" variant="outline" disabled={generating} onClick={generateAiReport}>
          {generating ? "Generating…" : "Generate AI Report"}
        </Button>
        {aiReport ? (
          <div className="mt-3 flex items-start justify-between gap-2">
            <p className="text-sm whitespace-pre-wrap bg-accent/40 rounded-xl px-3 py-2.5 flex-1">{aiReport}</p>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Download report as text"
              onClick={() => {
                const blob = new Blob([aiReport], { type: "text/plain;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dayjoy-ai-report-${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
