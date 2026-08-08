import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Menu, X, Sparkles } from "lucide-react";
import { BUSINESS_HUB_SECTIONS, BUSINESS_HUB_LAST_SECTION_KEY, DEFAULT_SECTION } from "./sections";

/**
 * Workspace shell for the Business Hub — a fixed secondary sidebar (desktop),
 * collapsible rail (tablet), and drawer (mobile) that lets the distributor
 * jump between sections without leaving the workspace. Only the content
 * area re-renders on navigation (React Router client-side routing — no
 * full page reload). The last opened section is remembered per-browser.
 */
export function BusinessHubShell() {
  const location = useLocation();
  // Section routes are static children of /distributor/dashboard/<section>.
  const section = location.pathname.split("/distributor/dashboard/")[1]?.split("/")[0];
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (section) {
      localStorage.setItem(BUSINESS_HUB_LAST_SECTION_KEY, section);
    }
  }, [section]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const activeSection = BUSINESS_HUB_SECTIONS.find((s) => s.path === section);

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 min-w-0">
      {/* Mobile top bar for the workspace. Must stack ABOVE the sidebar+content
          row (hence flex-col on the outer container above `lg:`) — as a sibling
          in a row flex container it used to claim its own column, squeezing
          the content area down to a sliver on phones. */}
      <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg hover:bg-accent/50"
          aria-label="Open Business Hub navigation"
          aria-expanded={drawerOpen}
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" /> Business Hub
        </span>
        {activeSection ? (
          <span className="text-xs text-muted-foreground ml-1">/ {activeSection.label}</span>
        ) : null}
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Secondary sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-[45] w-64 md:w-56 lg:w-56 bg-card border-r border-border flex flex-col shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        aria-label="Business Hub sections"
      >
        <div className="hidden lg:flex items-center gap-2 px-4 py-4 border-b border-border">
          <Sparkles className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Business Hub</p>
            <p className="text-[10px] text-muted-foreground">AI Business Workspace</p>
          </div>
        </div>
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Business Hub</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-lg hover:bg-accent/50"
            aria-label="Close Business Hub navigation"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-3 space-y-0.5" aria-label="Business Hub sections">
          {BUSINESS_HUB_SECTIONS.map((s) => (
            <NavLink
              key={s.key}
              to={`/distributor/dashboard/${s.path}`}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-raised"
                    : "hover:bg-accent/60 hover:translate-x-0.5 text-foreground"
                }`
              }
            >
              <s.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{s.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Content area — only this re-renders on section change */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        <motion.div
          key={section || DEFAULT_SECTION}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        >
          <Outlet />
        </motion.div>
      </div>
    </div>
  );
}

/** Redirects `/distributor/dashboard` (no section) to the last-opened section, defaulting to Overview. */
export function BusinessHubIndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const last = localStorage.getItem(BUSINESS_HUB_LAST_SECTION_KEY);
    const valid = BUSINESS_HUB_SECTIONS.some((s) => s.path === last);
    navigate(`/distributor/dashboard/${valid && last ? last : DEFAULT_SECTION}`, { replace: true });
  }, [navigate]);
  return null;
}
