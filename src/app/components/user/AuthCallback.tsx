import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabaseClient";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { Button } from "../ui/button";

/**
 * OAuth redirect target (see `redirectTo` in `signInWithGoogle`).
 *
 * The main Supabase client has `detectSessionInUrl: false` (see
 * supabaseClient.ts) so supabase-js does not auto-parse the URL on every
 * page load. This route is the one place that manually completes the
 * PKCE code exchange, then hands off to AuthContext's onAuthStateChange
 * listener (which fires SIGNED_IN and resolves the user's role).
 */
export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      if (!isSupabaseConfigured() || !supabase) {
        if (!cancelled) setError("Supabase is not configured.");
        return;
      }

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

      if (oauthError) {
        if (!cancelled) setError(oauthError);
        return;
      }

      // PKCE flow (default): a ?code= query param to exchange.
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        window.location.replace("/");
        return;
      }

      // Implicit flow fallback: tokens arrive in the URL hash instead of a
      // code query param. Some Supabase project configs still produce this.
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
          return;
        }
        window.location.replace("/");
        return;
      }

      // Nothing to exchange (e.g. direct visit) — just go home.
      window.location.replace("/");
    }

    completeOAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="flex flex-col items-center gap-4 text-center rounded-3xl glass shadow-overlay px-8 py-10 max-w-sm">
        <DayjoyLogo variant="mark" size={48} className={error ? "" : "animate-pulse-glow"} />
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="secondary" size="sm">
              <a href="/login">Back to login</a>
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in to {BRAND.name}…</p>
        )}
      </div>
    </div>
  );
}
