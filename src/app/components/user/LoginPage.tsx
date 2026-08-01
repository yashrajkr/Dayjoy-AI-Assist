import { useState, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import {
  signInUser,
  signUpUser,
  signInWithGoogle,
  getCurrentUser,
  getCurrentSession,
  getUserRoleFromMetadata,
  type UserRole,
} from "../../lib/auth";
import { isSupabaseConfigured, getSupabaseConfigError } from "../../lib/supabaseClient";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { AnimatedBackground } from "../common/AnimatedBackground";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSwitcher } from "../common/LanguageSwitcher";

// Lazy-load the 3D orb — it's a heavy chunk (three.js + R3F)
const AIOrb = lazy(() =>
  import("../three/AIOrb").then((m) => ({ default: m.AIOrb })),
);

/** Time-based greeting shown above the orb. */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Public-facing roles available for self-signup.
 *
 * NOTE: `admin` and `management` are intentionally absent. Staff roles are
 * assigned via admin invite / role-elevation flow only — see
 * `UserManagement.tsx` and the `handle_new_user()` SQL trigger in
 * `supabase_schema.sql`. This is the first of two layers of defense against
 * privilege escalation; the second is the SQL trigger itself, which rejects
 * staff roles in `raw_user_meta_data` unless the caller is already admin.
 */
type SignupRole = "customer" | "distributor" | "employee";

const SIGNUP_ROLES: { value: SignupRole; label: string; description: string }[] = [
  { value: "customer", label: "Customer", description: "Shop products, ask questions, get support" },
  { value: "distributor", label: "Distributor", description: "Build your business with training & coaching" },
  { value: "employee", label: "Employee", description: "Internal staff access (verified separately)" },
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<SignupRole>("customer");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info" | "success"; text: string } | null>(null);

  const supabaseReady = isSupabaseConfigured();
  const supabaseError = getSupabaseConfigError();

  function redirectAfterAuth(resolvedRole: UserRole | null | undefined) {
    const r = resolvedRole ?? role;
    if (r === "admin" || r === "management") {
      window.location.href = "/admin/dashboard";
      return;
    }
    if (r === "employee") {
      window.location.href = "/admin/employee";
      return;
    }
    window.location.href = "/";
  }

  async function demoFallbackLogin() {
    const key = "dayjoy_demo_auth";
    const nowIso = new Date().toISOString();
    window.localStorage.setItem(
      key,
      JSON.stringify({ id: "demo-user", role: role as UserRole, created_at: nowIso }),
    );
    redirectAfterAuth(role as UserRole);
  }

  function normalizeAuthErrorToUi(err: unknown): string {
    const rawMessage = err instanceof Error ? err.message : String(err ?? "");
    const lower = rawMessage.toLowerCase();
    if (lower.includes("failed to fetch")) {
      return "Cannot connect to Supabase. Check VITE_SUPABASE_URL and your internet connection, then restart npm run dev.";
    }
    return rawMessage || "Login failed.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage(null);

    try {
      const trimmedEmail = email.trim();
      if (!isValidEmail(trimmedEmail)) {
        setMessage({ kind: "error", text: "Please enter a valid email address." });
        return;
      }
      if (!password.trim()) {
        setMessage({ kind: "error", text: "Password cannot be empty." });
        return;
      }
      if (mode === "signup" && password.length < 8) {
        setMessage({ kind: "error", text: "Password must be at least 8 characters." });
        return;
      }

      if (!supabaseReady) {
        setMessage({
          kind: "info",
          text: "Supabase is not configured. Using demo mode — changes will not be saved.",
        });
        await demoFallbackLogin();
        return;
      }

      if (mode === "login") {
        await signInUser({ email: trimmedEmail, password });
        await getCurrentSession();
        const user = await getCurrentUser();
        const resolvedRole = getUserRoleFromMetadata(user);
        redirectAfterAuth(resolvedRole);
      } else {
        if (!fullName.trim()) {
          setMessage({ kind: "error", text: "Full name cannot be empty." });
          return;
        }
        await signUpUser({
          email: trimmedEmail,
          password,
          fullName: fullName.trim(),
          role,
        });
        setMessage({
          kind: "success",
          text: "Account created. Please log in to continue.",
        });
        setMode("login");
        setPassword("");
      }
    } catch (err) {
      setMessage({ kind: "error", text: normalizeAuthErrorToUi(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    if (googleLoading || loading) return;
    setMessage(null);

    if (!supabaseReady) {
      setMessage({
        kind: "error",
        text: "Google sign-in requires Supabase to be configured.",
      });
      return;
    }

    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // Browser navigates to Google now; this component unmounts.
    } catch (err) {
      setMessage({ kind: "error", text: normalizeAuthErrorToUi(err) });
      setGoogleLoading(false);
    }
  }

  const pwStrength = mode === "signup" ? passwordStrength(password) : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative theme-transition">
      <AnimatedBackground variant="subtle" />

      {/* Top-right controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        <LanguageSwitcher className="glass" />
        <ThemeToggle className="glass" />
      </div>

      <a
        href="#login-form"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to login form
      </a>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md glass rounded-3xl shadow-2xl p-6 sm:p-8 relative"
      >
        {/* 3D AI orb — lazy loaded */}
        <div className="flex flex-col items-center mb-5 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
            className="relative"
          >
            <Suspense
              fallback={
                <div
                  className="w-32 h-32 rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center"
                  aria-hidden="true"
                >
                  <DayjoyLogo variant="mark" size={48} />
                </div>
              }
            >
              <AIOrb state="idle" size={160} />
            </Suspense>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="text-xs text-muted-foreground uppercase tracking-wider mt-3"
          >
            {getGreeting()}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            className="text-2xl sm:text-3xl font-semibold text-foreground mt-1"
          >
            {BRAND.name}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
            className="text-sm text-muted-foreground mt-1"
          >
            {BRAND.tagline}
          </motion.p>
        </div>

        {!supabaseReady && (
          <div
            className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
            role="alert"
          >
            <strong className="font-semibold">Demo mode active.</strong>{" "}
            {supabaseError
              ? "Supabase is not configured — your session will be local only."
              : "Sign in with any credentials to explore the UI."}
          </div>
        )}

        {message && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={
              message.kind === "error"
                ? { opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }
                : { opacity: 1, y: 0 }
            }
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={`mb-4 rounded-xl border px-3 py-2 text-sm ${
              message.kind === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : message.kind === "success"
                  ? "border-primary/30 bg-accent text-accent-foreground"
                  : "border-border bg-background text-foreground"
            }`}
            role="alert"
          >
            {message.text}
          </motion.div>
        )}

        <div className="flex gap-2 mb-6" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              setMode("login");
              setMessage(null);
            }}
            className={`flex-1 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
              mode === "login"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-accent/50"
            }`}
            disabled={loading}
          >
            Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => {
              setMode("signup");
              setMessage(null);
            }}
            className={`flex-1 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
              mode === "signup"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-accent/50"
            }`}
            disabled={loading}
          >
            Sign up
          </button>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-3 font-medium text-foreground shadow-sm hover:bg-accent/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mb-5"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
            <path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.27-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z" />
          </svg>
          {googleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3 mb-5" aria-hidden="true">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or continue with email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <label htmlFor="dj-login-fullname" className="block text-xs font-medium text-muted-foreground mb-1">
                  Full name
                </label>
                <input
                  id="dj-login-fullname"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                  disabled={loading}
                  autoComplete="name"
                  required
                />
              </div>

              <div>
                <label htmlFor="dj-login-role" className="block text-xs font-medium text-muted-foreground mb-1">
                  I am a…
                </label>
                <select
                  id="dj-login-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as SignupRole)}
                  className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                  disabled={loading}
                >
                  {SIGNUP_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label} — {r.description}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Admin and Management accounts cannot be self-registered. Contact your Dayjoy administrator.
                </p>
              </div>
            </>
          )}

          <div>
            <label htmlFor="dj-login-email" className="block text-xs font-medium text-muted-foreground mb-1">
              Email
            </label>
            <input
              id="dj-login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              disabled={loading}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="dj-login-password" className="block text-xs font-medium text-muted-foreground mb-1">
              Password
            </label>
            <input
              id="dj-login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border rounded-xl p-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              disabled={loading}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            {pwStrength && password.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
                <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      pwStrength.score <= 1
                        ? "bg-destructive w-1/4"
                        : pwStrength.score === 2
                          ? "bg-warning w-1/2"
                          : pwStrength.score === 3
                            ? "bg-secondary w-3/4"
                            : "bg-primary w-full"
                    }`}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">{pwStrength.label}</span>
              </div>
            )}
          </div>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={loading ? undefined : { scale: 1.01 }}
            whileTap={loading ? undefined : { scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="w-full bg-primary text-primary-foreground rounded-xl px-5 py-3 font-medium shadow-sm hover:opacity-90 hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? "Please wait…" : mode === "login" ? "Login" : "Create Account"}
          </motion.button>
        </form>

        <p className="text-xs text-muted-foreground mt-5 text-center">
          By continuing you agree to use {BRAND.name} only for approved Dayjoy business.
        </p>
      </motion.div>
    </div>
  );
}
