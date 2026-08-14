import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabaseClient";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { Button } from "../ui/button";

/**
 * Password-reset landing page — `redirectTo` target for
 * `resetPasswordForEmail` (see `SecuritySettings.tsx` / `auth.ts`).
 *
 * Mirrors `AuthCallback.tsx`'s code/hash exchange (the main client has
 * `detectSessionInUrl: false`, so this route does it manually) but instead
 * of redirecting home once a session exists, it lets the user set a new
 * password via `auth.updateUser`.
 */
export function ResetPassword() {
  const [status, setStatus] = useState<"exchanging" | "ready" | "saving" | "done" | "error">("exchanging");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function completeExchange() {
      if (!isSupabaseConfigured() || !supabase) {
        if (!cancelled) {
          setError("Supabase is not configured.");
          setStatus("error");
        }
        return;
      }

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

      if (oauthError) {
        if (!cancelled) {
          setError(oauthError);
          setStatus("error");
        }
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setError(exchangeError.message);
          setStatus("error");
          return;
        }
        setStatus("ready");
        return;
      }

      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (setSessionError) {
          setError(setSessionError.message);
          setStatus("error");
          return;
        }
        setStatus("ready");
        return;
      }

      if (!cancelled) {
        setError("This reset link is invalid or has expired. Request a new one from Settings.");
        setStatus("error");
      }
    }

    completeExchange();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("saving");
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setStatus("ready");
      return;
    }
    setStatus("done");
    setTimeout(() => window.location.replace("/"), 1800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="flex flex-col items-center gap-4 text-center rounded-3xl glass shadow-overlay px-8 py-10 max-w-sm w-full">
        <DayjoyLogo variant="mark" size={48} className={status === "exchanging" ? "animate-pulse-glow" : ""} />

        {status === "exchanging" ? (
          <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
        ) : null}

        {status === "error" ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="secondary" size="sm">
              <a href="/login">Back to login</a>
            </Button>
          </>
        ) : null}

        {status === "ready" || status === "saving" ? (
          <form onSubmit={handleSubmit} className="w-full space-y-3 text-left">
            <p className="text-sm text-muted-foreground text-center">Choose a new password for {BRAND.name}.</p>
            <div>
              <label htmlFor="new-password" className="sr-only">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="sr-only">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Set new password"}
            </Button>
          </form>
        ) : null}

        {status === "done" ? <p className="text-sm text-primary">Password updated. Signing you in…</p> : null}
      </div>
    </div>
  );
}
