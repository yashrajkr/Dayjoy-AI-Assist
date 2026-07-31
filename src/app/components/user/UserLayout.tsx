import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { pageTransition } from "../../lib/motion";
import {
  Plus,
  Settings,
  ChevronRight,
  Package,
  Users,
  LifeBuoy,
  Menu,
  X,
  ShieldCheck,
  GraduationCap,
  LayoutDashboard,
  Clock,
  Sparkles,
  BarChart3,
  Heart,
  Target,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSwitcher } from "../common/LanguageSwitcher";
import { Onboarding } from "../onboarding/Onboarding";

/**
 * User-facing app shell — left sidebar with primary nav + user card.
 *
 * Mobile: sidebar collapses into a drawer toggled by a hamburger button
 * in the top bar. The drawer overlay closes on click-outside / Escape.
 *
 * Accessibility:
 *  - Skip link to main content
 *  - aria-label on every icon-only button
 *  - aria-current on active NavLink
 *  - Focus trap inside the mobile drawer (lightweight: focuses the close btn)
 */
export function UserLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, currentUser, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const canDistributor = role === "distributor" || role === "admin" || role === "management";
  const canEmployee = role === "employee" || role === "admin" || role === "management";

  const userInitials =
    currentUser?.email?.slice(0, 2).toUpperCase() ??
    currentUser?.user_metadata?.full_name?.slice(0, 2)?.toUpperCase() ??
    "DU";
  const userName =
    (currentUser?.user_metadata?.full_name as string | undefined) ||
    currentUser?.email?.split("@")[0] ||
    "Dayjoy User";
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "Guest";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="h-screen flex bg-background">
      <a
        href="#dj-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center justify-between px-4 glass border-b border-border">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg hover:bg-accent/50"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="dj-user-drawer"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <DayjoyLogo variant="full" size={28} />
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {drawerOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Sidebar (also mobile drawer) */}
      <aside
        id="dj-user-drawer"
        className={`fixed lg:static inset-y-0 left-0 z-40 w-72 sm:w-80 glass border-r border-border flex flex-col transition-transform duration-200 scrollbar-thin
          ${drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          lg:flex`}
        aria-label="Primary navigation"
      >
        <div className="lg:hidden flex items-center justify-between p-3 border-b border-border">
          <DayjoyLogo variant="full" size={32} />
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-lg hover:bg-accent/50"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Brand + new chat */}
        <div className="p-4 border-b border-border hidden lg:block">
          <div className="flex items-center gap-3 mb-4">
            <DayjoyLogo variant="mark" size={40} />
            <div>
              <h1 className="font-semibold text-sm">{BRAND.name}</h1>
              <p className="text-xs text-muted-foreground">{BRAND.tagline}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigate("/");
              setDrawerOpen(false);
            }}
            className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Chat
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          <p className="text-xs font-medium text-muted-foreground mb-2 px-3 uppercase tracking-wide">
            {BRAND.shortName}
          </p>
          <div className="space-y-1">
            <NavItem to="/" icon={Plus} label="AI Chat" onClick={() => setDrawerOpen(false)} />
            <NavItem to="/dashboard" icon={LayoutDashboard} label="My Dashboard" onClick={() => setDrawerOpen(false)} />
            <NavItem to="/products" icon={Package} label="Product Discovery" onClick={() => setDrawerOpen(false)} />
            <NavItem to="/knowledge" icon={Search} label="Knowledge Center" onClick={() => setDrawerOpen(false)} />
            <NavItem to="/favorites" icon={Heart} label="Favorites" onClick={() => setDrawerOpen(false)} />
            <NavItem to="/wellness" icon={Target} label="Wellness Journey" onClick={() => setDrawerOpen(false)} />
            {canDistributor ? (
              <>
                <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Distributor Hub</div>
                <NavItem to="/distributor/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor" icon={Users} label="AI Sales Coach" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor/customers" icon={Users} label="Customers" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor/follow-ups" icon={Clock} label="Follow-ups" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor/content" icon={Sparkles} label="Content Generator" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor/team" icon={Users} label="My Team" onClick={() => setDrawerOpen(false)} />
                <NavItem to="/distributor/analytics" icon={BarChart3} label="Analytics" onClick={() => setDrawerOpen(false)} />
              </>
            ) : null}
            {canDistributor ? (
              <NavItem to="/training" icon={GraduationCap} label="Training" onClick={() => setDrawerOpen(false)} />
            ) : null}
            {canEmployee ? (
              <NavItem to="/support" icon={LifeBuoy} label="Human Support" onClick={() => setDrawerOpen(false)} />
            ) : null}
          </div>
        </nav>

        {/* User card */}
        <div className="p-3 border-t border-border space-y-2">
          <NavLink
            to="/settings"
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              `w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                isActive ? "bg-accent" : "hover:bg-accent/50"
              }`
            }
          >
            <div
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-sm"
              aria-hidden="true"
            >
              {userInitials}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <Settings className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          </NavLink>

          {(role === "admin" || role === "management" || role === "employee") ? (
            <NavLink
              to="/admin"
              onClick={() => setDrawerOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Admin Console</span>
              <ChevronRight className="w-3 h-3 ml-auto" aria-hidden="true" />
            </NavLink>
          ) : null}

          {/* Desktop theme toggle + language */}
          <div className="hidden lg:flex justify-end gap-1 pt-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        id="dj-main-content"
        className="flex-1 flex flex-col min-w-0 pt-14 lg:pt-0"
        tabIndex={-1}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={pageTransition}
            className="h-full flex flex-col min-w-0"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* First-time user onboarding overlay */}
      <Onboarding />
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `relative w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "hover:bg-accent/60 text-foreground"
        }`
      }
      aria-current="page"
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId="user-nav-active"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-foreground rounded-r-full"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          ) : null}
          <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}
