import { useNavigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { Shield, ChevronRight } from "lucide-react";
import { BRAND } from "../lib/brand";
import { DayjoyLogo } from "./brand/DayjoyLogo";
import { AnimatedBackground } from "./common/AnimatedBackground";
import { ThemeToggle } from "./common/ThemeToggle";

const AIOrb = lazy(() =>
  import("./three/AIOrb").then((m) => ({ default: m.AIOrb })),
);

export function AppSelector() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative theme-transition">
      <AnimatedBackground />

      {/* Top-right theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle className="glass" />
      </div>

      <a
        href="#dj-selector-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div id="dj-selector-main" className="max-w-4xl w-full relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-12"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            className="flex justify-center mb-6"
          >
            <Suspense
              fallback={
                <div className="w-32 h-32 rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center">
                  <DayjoyLogo variant="mark" size={56} />
                </div>
              }
            >
              <AIOrb state="idle" size={160} />
            </Suspense>
          </motion.div>
          <h1 className="text-3xl sm:text-4xl font-semibold mb-3 text-gradient">{BRAND.name}</h1>
          <p className="text-base sm:text-lg text-muted-foreground">{BRAND.tagline}</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
            {BRAND.description}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.button
            type="button"
            onClick={() => navigate("/")}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl p-6 sm:p-8 hover:shadow-2xl transition-shadow group text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <div className="w-14 h-14 rounded-xl bg-primary/10 mb-5 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <DayjoyLogo variant="mark" size={32} />
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold mb-2">{BRAND.name}</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Ask questions about Dayjoy products, get business support, and receive AI-powered guidance from approved company knowledge.
            </p>
            <div className="flex items-center gap-2 text-primary font-medium text-sm">
              <span>Open {BRAND.shortName}</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
            </div>
            <div className="mt-5 pt-5 border-t border-border">
              <p className="text-xs text-muted-foreground">For: Customers, Distributors, Employees</p>
            </div>
          </motion.button>

          <motion.button
            type="button"
            onClick={() => navigate("/admin")}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl p-6 sm:p-8 hover:shadow-2xl transition-shadow group text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <div className="w-14 h-14 rounded-xl bg-accent mb-5 flex items-center justify-center group-hover:bg-accent/70 transition-colors">
              <Shield className="w-7 h-7 text-primary" aria-hidden="true" />
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold mb-2">Admin Console</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Manage knowledge base, approve content, monitor AI performance, and control system settings.
            </p>
            <div className="flex items-center gap-2 text-primary font-medium text-sm">
              <span>Open Admin Console</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
            </div>
            <div className="mt-5 pt-5 border-t border-border">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">For: Dayjoy Staff Only</p>
                <span className="px-2 py-0.5 bg-warning/15 text-warning text-[11px] font-medium rounded">
                  Restricted
                </span>
              </div>
            </div>
          </motion.button>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-12 text-center text-xs text-muted-foreground"
        >
          Powered by approved Dayjoy knowledge · Secure & Compliant · {BRAND.name} v1.0
        </motion.p>
      </div>
    </div>
  );
}
