import { useCallback, useEffect, useState } from "react";
import { Users, Award, TrendingUp, Trophy, Star, Loader2, Plus } from "lucide-react";
import { LoadingState, ErrorState, EmptyState, btnClass } from "../common/AdminUI";
import { Modal, modalButtonClass } from "../common/Modal";
import { distributorTeamOverview, distributorAddRecognition, type TeamMember } from "../../../lib/api";

const AWARDS = [
  { type: "top_performer", icon: "🏆", label: "Top Performer" },
  { type: "rising_star", icon: "⭐", label: "Rising Star" },
  { type: "best_mentor", icon: "🎓", label: "Best Mentor" },
  { type: "sales_champion", icon: "💰", label: "Sales Champion" },
  { type: "recruitment_leader", icon: "🚀", label: "Recruitment Leader" },
  { type: "training_complete", icon: "📚", label: "Training Complete" },
];

export function TeamManagement() {
  const [data, setData] = useState<{ members: TeamMember[]; active_count: number; total_sales: number; avg_training: number; recognition: Array<Record<string, unknown>>; leaderboard: TeamMember[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awardModal, setAwardModal] = useState<TeamMember | null>(null);
  const [awardType, setAwardType] = useState("top_performer");
  const [awardTitle, setAwardTitle] = useState("");
  const [awarding, setAwarding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await distributorTeamOverview();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const giveAward = async () => {
    if (!awardModal) return;
    setAwarding(true);
    try {
      const award = AWARDS.find((a) => a.type === awardType);
      await distributorAddRecognition({
        member_id: awardModal.member_id,
        member_name: awardModal.member_name,
        award_type: awardType,
        title: awardTitle || award?.label || "Award",
        badge_icon: award?.icon || "🏆",
      });
      setAwardModal(null);
      setAwardTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAwarding(false);
    }
  };

  if (loading) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><LoadingState /></div>;
  if (error) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><ErrorState message={error} /></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Users className="w-5 h-5" /> My Team</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your downline and recognize achievements.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">{data.active_count}</p><p className="text-[10px] text-muted-foreground">Active Members</p></div>
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">₹{data.total_sales.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Total Sales</p></div>
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">{data.avg_training}%</p><p className="text-[10px] text-muted-foreground">Avg Training</p></div>
        <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-2xl font-semibold">{data.recognition.length}</p><p className="text-[10px] text-muted-foreground">Awards Given</p></div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Trophy className="w-4 h-4 text-amber-500" /> Leaderboard</h2>
        {data.leaderboard.length === 0 ? (
          <EmptyState title="No team members" icon={<Users className="w-5 h-5" />} />
        ) : (
          <div className="space-y-1.5">
            {data.leaderboard.slice(0, 10).map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-100 text-slate-700" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-accent text-muted-foreground"}`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.member_name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.rank} · Lvl {m.level} · {m.training_completion}% trained</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">₹{Number(m.total_sales || 0).toLocaleString()}</span>
                <button type="button" onClick={() => { setAwardModal(m); setAwardType("top_performer"); setAwardTitle(""); }}
                  className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 flex items-center gap-0.5"><Award className="w-3 h-3" /> Award</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent recognition */}
      {data.recognition.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Star className="w-4 h-4 text-amber-500" /> Recent Recognition</h2>
          <div className="space-y-1.5">
            {data.recognition.slice(0, 5).map((r) => (
              <div key={String(r.id)} className="flex items-center gap-2 p-2 rounded-lg bg-accent/20">
                <span className="text-lg">{String(r.badge_icon || "🏆")}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{String(r.title || "Award")}</p>
                  <p className="text-[10px] text-muted-foreground">{String(r.member_name || "")} · {r.awarded_at ? new Date(String(r.awarded_at)).toLocaleDateString() : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Award modal */}
      <Modal open={!!awardModal} onClose={() => setAwardModal(null)} title={`Recognize ${awardModal?.member_name ?? ""}`} size="sm"
        footer={<>
          <button type="button" className={modalButtonClass.secondary} onClick={() => setAwardModal(null)}>Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={giveAward} disabled={awarding}>
            {awarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />} Give Award
          </button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {AWARDS.map((a) => (
              <button key={a.type} type="button" onClick={() => setAwardType(a.type)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border ${awardType === a.type ? "border-primary bg-primary/5" : "border-border"}`}>
                <span className="text-2xl">{a.icon}</span>
                <span className="text-[10px] text-center">{a.label}</span>
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Custom title (optional)</label>
            <input type="text" value={awardTitle} onChange={(e) => setAwardTitle(e.target.value)} placeholder="e.g. Best Q3 Performance"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
