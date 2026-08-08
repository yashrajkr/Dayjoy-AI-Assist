import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass } from "lucide-react";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { AnimatedBackground } from "./AnimatedBackground";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "../ui/button";

/**
 * Catch-all for any URL that doesn't match a route. Previously this
 * silently redirected to "/", which made a typo'd or dead link
 * indistinguishable from a working page that just happened to load Chat —
 * confusing on its own, and actively misleading for a bookmarked/shared
 * link to a page that got renamed or removed.
 */
export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative theme-transition">
      <AnimatedBackground variant="subtle" />

      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle className="glass" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md glass rounded-3xl shadow-overlay p-6 sm:p-8 text-center relative z-10"
      >
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <DayjoyLogo variant="mark" size={36} />
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
          <Compass className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">404</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-semibold mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          That page doesn't exist in {BRAND.name} — it may have moved, been renamed, or the link was mistyped.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)} className="flex-1 h-auto rounded-xl px-4 py-3">
            Go back
          </Button>
          <Button type="button" onClick={() => navigate("/")} className="flex-1 h-auto rounded-xl px-4 py-3">
            Go to Home
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
