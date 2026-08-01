import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { pageTransition } from "../../lib/motion";
import {
  Search,
  HelpCircle,
  LayoutDashboard,
  Database,
  Package,
  FileQuestion,
  FileText,
  GraduationCap,
  Shield,
  CheckSquare,
  Users,
  Headphones,
  BarChart3,
  Settings as SettingsIcon,
  ClipboardList,
  Plug,
  Briefcase,
  Building2,
  History,
  GitBranch,
  TrendingUp,
  Menu,
  X,
  ChevronRight,
  ChevronsLeft,
  Brain,
  Lock,
  MessageSquare,
  Send,
  Bot,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSwitcher } from "../common/LanguageSwitcher";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { Input } from "../ui/input";

type NavItemDef = {
  to: string;
  icon: LucideIcon;
  label: string;
  adminOnly?: boolean;
};

const NAV_SECTIONS: { heading: string; items: NavItemDef[] }[] = [
  {
    heading: "Overview",
    items: [
      { to: "/admin/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/admin/executive", icon: TrendingUp, label: "Executive BI" },
      { to: "/admin/analytics-hub", icon: BarChart3, label: "Analytics Hub" },
      { to: "/admin/search", icon: Search, label: "Universal Search" },
      { to: "/admin/analytics", icon: BarChart3, label: "Legacy Analytics" },
    ],
  },
  {
    heading: "Knowledge",
    items: [
      { to: "/admin/knowledge", icon: Database, label: "Knowledge Base" },
      { to: "/admin/products", icon: Package, label: "Product Database" },
      { to: "/admin/faqs", icon: FileQuestion, label: "FAQ Manager" },
      { to: "/admin/policies", icon: FileText, label: "Policy Manager" },
      { to: "/admin/training", icon: GraduationCap, label: "Training Manager" },
      { to: "/admin/approvals", icon: CheckSquare, label: "Approval Queue" },
    ],
  },
  {
    heading: "AI & Safety",
    items: [
      { to: "/admin/ai-config", icon: Brain, label: "AI Configuration" },
      { to: "/admin/agents", icon: Bot, label: "AI Agent Center" },
      { to: "/admin/workflows", icon: Workflow, label: "Workflow Automation" },
      { to: "/admin/safety", icon: Shield, label: "AI Safety Rules" },
    ],
  },
  {
    heading: "Communication",
    items: [
      { to: "/admin/communication", icon: MessageSquare, label: "Comm Center" },
      { to: "/admin/comm-hub", icon: Send, label: "Campaigns & Hub" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/admin/leads", icon: ClipboardList, label: "Leads / CRM" },
      { to: "/admin/users", icon: Users, label: "User Management", adminOnly: true },
      { to: "/admin/support", icon: Headphones, label: "Support Tickets" },
      { to: "/admin/timeline", icon: GitBranch, label: "Knowledge Timeline" },
    ],
  },
  {
    heading: "Security & Audit",
    items: [
      { to: "/admin/security", icon: Shield, label: "Security Center" },
      { to: "/admin/roles", icon: Lock, label: "Role Permissions", adminOnly: true },
      { to: "/admin/audit", icon: History, label: "Audit Logs", adminOnly: true },
    ],
  },
  {
    heading: "Roles",
    items: [
      { to: "/admin/employee", icon: Briefcase, label: "Employee Dashboard" },
      { to: "/admin/leader", icon: TrendingUp, label: "Leader Dashboard" },
      { to: "/admin/trainer", icon: GraduationCap, label: "Trainer Dashboard" },
      { to: "/admin/support-team", icon: Headphones, label: "Support Dashboard" },
      { to: "/admin/management", icon: Building2, label: "Management" },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/admin/integrations", icon: Plug, label: "Integrations" },
      { to: "/admin/settings", icon: SettingsIcon, label: "Settings", adminOnly: true },
    ],
  },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, currentUser, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("dj-admin-sidebar-collapsed") === "1");

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dj-admin-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  const userInitials =
    currentUser?.email?.slice(0, 2).toUpperCase() ??
    currentUser?.user_metadata?.full_name?.slice(0, 2)?.toUpperCase() ??
    "AD";
  const userName =
    (currentUser?.user_metadata?.full_name as string | undefined) ||
    currentUser?.email?.split("@")[0] ||
    "Admin User";
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "Admin";

  const filteredSections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.adminOnly || role === "admin"),
  })).filter((s) => s.items.length > 0);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex">
      <a
        href="#dj-admin-main"
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
          aria-controls="dj-admin-drawer"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <DayjoyLogo variant="full" size={28} />
        <ThemeToggle />
      </header>

      {drawerOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        id="dj-admin-drawer"
        className={`fixed lg:static inset-y-0 left-0 z-40 w-72 sm:w-80 ${collapsed ? "lg:w-[76px]" : "lg:w-80"} glass border-r border-border flex flex-col transition-[transform,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] scrollbar-thin
          ${drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          lg:flex`}
        aria-label="Admin navigation"
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

        <div className="p-4 border-b border-border hidden lg:block">
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
            <DayjoyLogo variant="mark" size={40} />
            {!collapsed ? (
              <div className="min-w-0">
                <h1 className="font-semibold text-sm truncate">{BRAND.name}</h1>
                <p className="text-xs text-muted-foreground truncate">Admin Console</p>
              </div>
            ) : null}
          </div>
        </div>

        <nav
          className="flex-1 overflow-y-auto p-3 space-y-4"
          aria-label="Admin sections"
        >
          {filteredSections.map((section) => (
            <div key={section.heading}>
              {!collapsed ? (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-3 mb-1.5">
                  {section.heading}
                </p>
              ) : (
                <div className="h-px bg-border mx-2 mb-1.5" aria-hidden="true" />
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <AdminNavItem
                    key={item.to}
                    to={item.to}
                    icon={item.icon}
                    label={item.label}
                    collapsed={collapsed}
                    onClick={() => setDrawerOpen(false)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border space-y-2">
          <div className={`flex items-center gap-3 p-2 bg-accent/50 rounded-lg ${collapsed ? "justify-center" : ""}`}>
            <div
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-sm shrink-0"
              aria-hidden="true"
            >
              {userInitials}
            </div>
            {!collapsed ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{userName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
            ) : null}
          </div>

          <NavLink
            to="/"
            onClick={() => setDrawerOpen(false)}
            title="View User App"
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            {!collapsed ? (
              <>
                <span>View User App</span>
                <ChevronRight className="w-3 h-3 ml-auto" aria-hidden="true" />
              </>
            ) : (
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </NavLink>

          <div className={`hidden lg:flex items-center pt-1 ${collapsed ? "justify-center" : "justify-end"}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-2 rounded-lg hover:bg-accent/50 text-muted-foreground transition-colors"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronsLeft className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className={`w-full text-left px-3 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors ${collapsed ? "text-center" : ""}`}
          >
            {collapsed ? <X className="w-3.5 h-3.5 mx-auto" aria-hidden="true" /> : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pt-14 lg:pt-0">
        <header className="glass border-b border-border px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 max-w-xl">
              <label htmlFor="dj-admin-search" className="sr-only">
                Search products, FAQs, users
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="dj-admin-search"
                  type="search"
                  placeholder="Search products, FAQs, users… (press / to focus)"
                  className="w-full pl-9 pr-4 py-2 h-auto bg-background/60 rounded-lg cursor-pointer"
                  onFocus={(e) => {
                    e.target.blur();
                    navigate("/admin/search");
                  }}
                  readOnly
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <NotificationCenter />
              <button
                type="button"
                className="p-2 hover:bg-accent rounded-lg transition-colors"
                aria-label="Help"
              >
                <HelpCircle className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              </button>
              <LanguageSwitcher />
              <ThemeToggle />
              <span className="hidden sm:inline-flex px-3 py-1 bg-accent text-accent-foreground text-xs font-medium rounded-full">
                Internal Staff Only
              </span>
            </div>
          </div>
        </header>

        <main id="dj-admin-main" className="flex-1 overflow-auto" tabIndex={-1}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageTransition}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function AdminNavItem({
  to,
  icon: Icon,
  label,
  collapsed = false,
  onClick,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/admin"}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 ${collapsed ? "justify-center" : ""} ${
          isActive
            ? "bg-primary text-primary-foreground font-medium shadow-raised"
            : "text-foreground hover:bg-accent/60 hover:translate-x-0.5"
        }`
      }
      aria-current="page"
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId="admin-nav-active"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-foreground rounded-r-full"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          ) : null}
          <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          {!collapsed ? <span className="text-sm">{label}</span> : null}
        </>
      )}
    </NavLink>
  );
}
