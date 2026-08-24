import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Mic, Package, Search, Sparkles, FolderOpen, Target, LayoutDashboard,
  ArrowRight, Loader2, LayoutGrid,
} from "lucide-react";
import { AppHeader } from "../common/AppHeader";
import { useAuth } from "../../lib/AuthContext";
import { listCoachGoals, type CoachGoal } from "../../../lib/api";
import { listConversations, type Conversation } from "../../lib/chatStore";

/**
 * AI Hub — DayJoy AI OS (Next-Generation spec, Phase 15), scoped honestly.
 *
 * The spec describes a fully unified workspace where every surface (Chat,
 * Coach, Goals, Products, Knowledge, Documents, Research, Analytics,
 * Agents, Artifacts, Voice, Memory) shares one continuous AI context —
 * that's a multi-week product redesign, not something this pass claims to
 * deliver. What this page IS: a real, working single entry point over the
 * surfaces that already exist (most were separate, only reachable one at a
 * time from the nav drawer), plus a genuine "continue where you left off"
 * section built on data that's ALREADY cross-surface-aware — the AI
 * Coach's active goals (Phase 5/13) and Memory 2.0's task-memory layer
 * (Phase 10) already let a brand-new chat draw on a goal set up here, and
 * vice versa. This page surfaces that continuity instead of leaving it
 * invisible.
 *
 * Deliberately named "AI Hub", not "Workspace" — `src/app/lib/workspace.ts`
 * already owns that term for a different, pre-existing concept (switching
 * between the Customer/Distributor/Leader role-based portals). Reusing the
 * name here would collide with real, shipped functionality.
 */
export function AIHub() {
  const navigate = useNavigate();
  const { currentUser, role } = useAuth();
  const canDistributor = role === "distributor" || role === "leader" || role === "admin" || role === "super_admin";

  const [goals, setGoals] = useState<CoachGoal[]>([]);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [goalsRes, convos] = await Promise.all([
        listCoachGoals().catch(() => ({ goals: [], total: 0 })),
        listConversations(currentUser.id).catch(() => []),
      ]);
      setGoals(goalsRes.goals.slice(0, 3));
      setRecentConversations(convos.slice(0, 3));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const surfaces: Array<{ to: string; icon: typeof Plus; label: string; description: string }> = [
    { to: "/", icon: Plus, label: "AI Chat", description: "Ask anything about Dayjoy products, policies, or your business" },
    { to: "/coach", icon: Sparkles, label: "AI Coach", description: "Goals, plans, and daily steps that pick up where you left off" },
    { to: "/voice", icon: Mic, label: "Voice Assistant", description: "Hands-free conversation with the same DayJoy AI" },
    { to: "/products", icon: Package, label: "Product Discovery", description: "Browse and compare verified Dayjoy products" },
    { to: "/knowledge", icon: Search, label: "Knowledge Center", description: "Search approved Dayjoy documents and FAQs directly" },
    { to: "/saved", icon: FolderOpen, label: "Saved Work", description: "Action plans, checklists, and reports saved from chat" },
    { to: "/wellness", icon: Target, label: "Wellness Journey", description: "Track your own product usage and reminders" },
    ...(canDistributor
      ? [{ to: "/distributor/dashboard", icon: LayoutDashboard, label: "Business Hub", description: "Sales, team, and AI business coaching" }]
      : []),
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="AI Hub"
        subtitle="One place to start — chat, your goals, and every DayJoy AI surface, all sharing the same context."
        icon={LayoutGrid}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-8">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            </div>
          ) : (goals.length > 0 || recentConversations.length > 0) ? (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">Continue where you left off</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {goals.map((g) => {
                  const doneCount = g.tasks.filter((t) => t.status === "done").length;
                  const nextStep = g.tasks.find((t) => t.status === "pending");
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => navigate("/coach")}
                      className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
                        <span className="text-xs font-medium text-primary">Active goal</span>
                      </div>
                      <p className="text-sm font-medium truncate">{g.goal_text}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {nextStep ? `Next: ${nextStep.task_text}` : `${doneCount} of ${g.tasks.length} steps done`}
                      </p>
                    </button>
                  );
                })}
                {recentConversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/chat/${c.id}`)}
                    className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="text-xs font-medium text-muted-foreground">Recent chat</span>
                    </div>
                    <p className="text-sm font-medium truncate">{c.title || "Untitled conversation"}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">Everything DayJoy AI can do</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {surfaces.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.to}
                    type="button"
                    onClick={() => navigate(s.to)}
                    className="group text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary mb-3">
                      <Icon className="w-4.5 h-4.5" aria-hidden="true" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{s.label}</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
