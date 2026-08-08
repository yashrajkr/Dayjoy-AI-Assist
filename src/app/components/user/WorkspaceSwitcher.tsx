import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Briefcase, ChevronRight, LogOut, Lock, MessageSquare, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { signInUser } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabaseClient";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { AnimatedBackground } from "../common/AnimatedBackground";
import { ThemeToggle } from "../common/ThemeToggle";
import { Button } from "../ui/button";
import {
  getAvailableViews,
  markStepUpVerified,
  setLastWorkspace,
  WORKSPACE_VIEWS,
  type WorkspaceView,
} from "../../lib/workspace";

const VIEW_ICONS: Record<WorkspaceView, LucideIcon> = {
  customer: MessageSquare,
  distributor: Briefcase,
  leader: TrendingUp,
};

/**
 * Post-login "which page do you want to open" screen. Shown when an
 * account can access more than one workspace (e.g. a distributor account
 * can open the plain Customer experience or their Business Hub).
 *
 * Distributor / Leader are treated as elevated views: opening them requires
 * re-entering the account's Dayjoy ID (email) + password in this browser
 * session, even though the account is already signed in — a lightweight
 * step-up gate so a shared/unlocked device doesn't casually expose business
 * data behind a single tap.
 */
export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { role, currentUser, logout } = useAuth();
  const views = getAvailableViews(role);
  const preselected = searchParams.get("target") as WorkspaceView | null;
  const returnTo = searchParams.get("return");
  // Set only when reached via the in-app "Switch View" menu (see UserLayout /
  // AdminLayout / AccountMenu) — distinguishes a voluntary visit, which gets
  // a real way back, from the mandatory post-login screen, which doesn't
  // pretend there's a "previous page" to return to.
  const isVoluntary = Boolean((location.state as { voluntary?: boolean } | null)?.voluntary);

  const [pendingView, setPendingView] = useState<WorkspaceView | null>(
    preselected && views.includes(preselected) && WORKSPACE_VIEWS[preselected].requiresStepUp
      ? preselected
      : null,
  );

  function openView(view: WorkspaceView) {
    setLastWorkspace(view);
    const target = WORKSPACE_VIEWS[view];
    if (target.requiresStepUp) {
      setPendingView(view);
      return;
    }
    navigate(target.path);
  }

  function handleVerified(view: WorkspaceView) {
    markStepUpVerified(view);
    setLastWorkspace(view);
    navigate(returnTo || WORKSPACE_VIEWS[view].path);
  }

  async function handleSignOut() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative theme-transition">
      <AnimatedBackground />

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {isVoluntary ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate(-1)}
            className="h-auto gap-1.5 rounded-lg px-3 py-1.5 glass"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSignOut}
            className="h-auto gap-1.5 rounded-lg px-3 py-1.5 glass"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign out
          </Button>
        )}
        <ThemeToggle className="glass" />
      </div>

      <div className="max-w-3xl w-full relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10"
        >
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <DayjoyLogo variant="mark" size={36} />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold mb-2">Which page do you want to open?</h1>
          <p className="text-sm text-muted-foreground">
            {currentUser?.email ? `Signed in as ${currentUser.email}. ` : ""}
            You can switch between these anytime from the menu.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {pendingView ? (
            <StepUpForm
              key="stepup"
              view={pendingView}
              defaultEmail={currentUser?.email ?? ""}
              onCancel={() => setPendingView(null)}
              onVerified={() => handleVerified(pendingView)}
            />
          ) : (
            <motion.div
              key="picker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5"
            >
              {views.map((view, i) => {
                const def = WORKSPACE_VIEWS[view];
                const Icon = VIEW_ICONS[view];
                return (
                  <motion.button
                    key={view}
                    type="button"
                    onClick={() => openView(view)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.08 }}
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    className="glass rounded-2xl p-6 hover:shadow-2xl transition-shadow group text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 mb-4 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                    </div>
                    <h2 className="text-lg font-semibold mb-1.5">{def.label}</h2>
                    <p className="text-xs text-muted-foreground mb-4">{def.description}</p>
                    <div className="flex items-center gap-2 text-primary font-medium text-sm">
                      <span>Open</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
                    </div>
                    {def.requiresStepUp ? (
                      <div className="mt-4 pt-4 border-t border-border flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        <span>Requires Dayjoy ID confirmation</span>
                      </div>
                    ) : null}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StepUpForm({
  view,
  defaultEmail,
  onCancel,
  onVerified,
}: {
  view: WorkspaceView;
  defaultEmail: string;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = WORKSPACE_VIEWS[view];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      if (!password.trim()) {
        setError("Password cannot be empty.");
        return;
      }
      if (isSupabaseConfigured()) {
        // Re-validates the account's actual credentials — the same check
        // used at login — before unlocking this elevated workspace.
        await signInUser({ email: email.trim(), password });
      }
      // Demo mode (Supabase not configured) mirrors the login page's demo
      // fallback: any non-empty password is accepted, no real check exists.
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-sm mx-auto glass rounded-2xl p-6 sm:p-7"
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Confirm it's you</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Enter the Dayjoy ID (email) and password from your account creation to open{" "}
        <span className="font-medium text-foreground">{def.label}</span>.
      </p>

      {error ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="dj-stepup-email" className="block text-xs font-medium text-muted-foreground mb-1">
            Dayjoy ID (Email)
          </label>
          <input
            id="dj-stepup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={loading}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label htmlFor="dj-stepup-password" className="block text-xs font-medium text-muted-foreground mb-1">
            Password
          </label>
          <input
            id="dj-stepup-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={loading}
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading} className="flex-1 h-auto rounded-xl px-4 py-2.5">
            Back
          </Button>
          <Button type="submit" disabled={loading} className="flex-1 h-auto rounded-xl px-4 py-2.5">
            {loading ? "Verifying…" : "Continue"}
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
