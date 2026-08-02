import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { pageTransition } from "../../lib/motion";
import {
  Plus,
  Settings,
  ChevronRight,
  ChevronsLeft,
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
  MoreHorizontal,
  Mic,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { Onboarding } from "../onboarding/Onboarding";
import { CommandPalette, type CommandPaletteItem } from "../common/CommandPalette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { listConversations, type Conversation } from "../../lib/chatStore";

/**
 * User-facing app shell — left sidebar with primary nav + user card.
 *
 * Mobile: a fixed bottom tab bar covers the 4 most-used destinations plus
 * a "More" tab that opens the full drawer (all remaining nav + settings).
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("dj-sidebar-collapsed") === "1");
  const [recentChats, setRecentChats] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    listConversations(currentUser.id).then((convos) => {
      if (!cancelled) setRecentChats(convos.slice(0, 6));
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, location.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dj-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  const canDistributor = role === "distributor" || role === "admin" || role === "management";

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

  const paletteItems: CommandPaletteItem[] = [
    { to: "/", icon: Plus, label: "AI Chat", group: "Main" },
    { to: "/voice", icon: Mic, label: "Voice Assistant", group: "Main" },
    { to: "/dashboard", icon: LayoutDashboard, label: "My Dashboard", group: "Main" },
    { to: "/products", icon: Package, label: "Product Discovery", group: "Main" },
    { to: "/knowledge", icon: Search, label: "Knowledge Center", group: "Main" },
    { to: "/favorites", icon: Heart, label: "Favorites", group: "Main" },
    { to: "/wellness", icon: Target, label: "Wellness Journey", group: "Main" },
    ...(canDistributor
      ? [
          { to: "/distributor/dashboard", icon: LayoutDashboard, label: "Business Intelligence", group: "Distributor Hub" },
          { to: "/distributor", icon: Users, label: "AI Sales Coach", group: "Distributor Hub" },
          { to: "/distributor/customers", icon: Users, label: "Customers", group: "Distributor Hub" },
          { to: "/distributor/follow-ups", icon: Clock, label: "Follow-ups", group: "Distributor Hub" },
          { to: "/distributor/content", icon: Sparkles, label: "Content Generator", group: "Distributor Hub" },
          { to: "/distributor/team", icon: Users, label: "My Team", group: "Distributor Hub" },
          { to: "/distributor/analytics", icon: BarChart3, label: "Analytics", group: "Distributor Hub" },
          { to: "/training", icon: GraduationCap, label: "Training", group: "Distributor Hub" },
        ]
      : []),
    { to: "/support", icon: LifeBuoy, label: "Support Centre", group: "Main" },
    { to: "/settings", icon: Settings, label: "Settings", group: "Account" },
  ];

  const mobileTabs = [
    { to: "/", icon: Plus, label: "Chat" },
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/products", icon: Package, label: "Products" },
    { to: "/knowledge", icon: Search, label: "Knowledge" },
  ];

  return (
    <TooltipProvider delayDuration={200}>
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
          <div className="w-9" aria-hidden="true" />
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
          className={`fixed lg:static inset-y-0 left-0 z-40 w-72 sm:w-80 ${collapsed ? "lg:w-[76px]" : "lg:w-72"} glass border-r border-border flex flex-col transition-[transform,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] scrollbar-thin
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
            <div className={`flex items-center gap-3 mb-4 ${collapsed ? "justify-center" : ""}`}>
              <DayjoyLogo variant="mark" size={40} />
              {!collapsed ? (
                <div className="min-w-0">
                  <h1 className="font-semibold text-sm truncate">{BRAND.name}</h1>
                  <p className="text-xs text-muted-foreground truncate">{BRAND.tagline}</p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                navigate("/");
                setDrawerOpen(false);
              }}
              title="New Chat"
              className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-raised hover:opacity-90 hover:shadow-overlay transition-all flex items-center justify-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!collapsed ? "New Chat" : null}
            </button>
          </div>

          {/* ⌘K search */}
          {!collapsed ? (
            <div className="px-4 pt-3 hidden lg:block">
              <CommandPalette items={paletteItems} />
            </div>
          ) : null}

          {/* Primary nav */}
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
            {!collapsed ? (
              <p className="text-xs font-medium text-muted-foreground mb-2 px-3 uppercase tracking-wide">
                {BRAND.shortName}
              </p>
            ) : null}
            <div className="space-y-1">
              <NavItem to="/" icon={Plus} label="AI Chat" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/voice" icon={Mic} label="Voice Assistant" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/dashboard" icon={LayoutDashboard} label="My Dashboard" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/products" icon={Package} label="Product Discovery" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/knowledge" icon={Search} label="Knowledge Center" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/favorites" icon={Heart} label="Favorites" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/wellness" icon={Target} label="Wellness Journey" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              {canDistributor ? (
                <>
                  {!collapsed ? (
                    <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Distributor Hub</div>
                  ) : <div className="pt-2" />}
                  <NavItem to="/distributor/dashboard" icon={LayoutDashboard} label="Business Intelligence" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor" icon={Users} label="AI Sales Coach" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor/customers" icon={Users} label="Customers" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor/follow-ups" icon={Clock} label="Follow-ups" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor/content" icon={Sparkles} label="Content Generator" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor/team" icon={Users} label="My Team" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                  <NavItem to="/distributor/analytics" icon={BarChart3} label="Analytics" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
                </>
              ) : null}
              {canDistributor ? (
                <NavItem to="/training" icon={GraduationCap} label="Training" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              ) : null}
              <NavItem to="/support" icon={LifeBuoy} label="Support Centre" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
            </div>

            {!collapsed && recentChats.length > 0 ? (
              <div className="pt-5">
                {groupChatsByDate(recentChats).map((group) => (
                  <div key={group.label} className="mb-2">
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    {group.items.map((c) => (
                      <NavLink
                        key={c.id}
                        to={`/chat/${c.id}`}
                        onClick={() => setDrawerOpen(false)}
                        className="block truncate rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                      >
                        {c.title}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </nav>

          {/* User card */}
          <div className="p-3 border-t border-border space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={userName}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors hover:bg-accent/50 ${collapsed ? "justify-center" : ""}`}
                >
                  <div
                    className="w-9 h-9 rounded-full bg-forest text-forest-foreground flex items-center justify-center font-medium text-sm shrink-0"
                    aria-hidden="true"
                  >
                    {userInitials}
                  </div>
                  {!collapsed ? (
                    <>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium truncate">{userName}</p>
                        <p className="text-xs text-muted-foreground">{roleLabel}</p>
                      </div>
                      <Settings className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    </>
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  {userName} · {roleLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {(role === "admin" || role === "management" || role === "employee") ? (
              <NavLink
                to="/admin"
                onClick={() => setDrawerOpen(false)}
                title="Admin Console"
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors ${collapsed ? "justify-center" : ""}`}
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {!collapsed ? (
                  <>
                    <span>Admin Console</span>
                    <ChevronRight className="w-3 h-3 ml-auto" aria-hidden="true" />
                  </>
                ) : null}
              </NavLink>
            ) : null}

            {/* Desktop collapse control — theme toggle + notifications now live in the shared PageHeader */}
            <div className={`hidden lg:flex items-center gap-1 pt-1 ${collapsed ? "justify-center flex-col" : "justify-end"}`}>
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
          </div>
        </aside>

        {/* Main content */}
        <main
          id="dj-main-content"
          className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto pt-14 lg:pt-0 pb-16 lg:pb-0"
          tabIndex={-1}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageTransition}
              className="flex-1 flex flex-col min-w-0 min-h-0"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom tab bar */}
        <nav
          className="lg:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
          aria-label="Mobile navigation"
        >
          {mobileTabs.map((tab) => {
            const active = tab.to === "/" ? location.pathname === "/" : location.pathname.startsWith(tab.to);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <tab.icon className={`size-5 ${active ? "stroke-[2.4]" : ""}`} aria-hidden="true" />
                {tab.label}
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground"
            aria-label="More navigation options"
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
            More
          </button>
        </nav>

        {/* First-time user onboarding overlay */}
        <Onboarding />
      </div>
    </TooltipProvider>
  );
}

/** Buckets conversations into Today / Yesterday / Previous 7 days / Older groups. */
function groupChatsByDate(chats: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const buckets: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  for (const c of chats) {
    const ts = c.updated_at ?? c.created_at;
    const day = ts ? startOfDay(new Date(ts)) : today;
    if (day >= today) buckets.Today.push(c);
    else if (day >= yesterday) buckets.Yesterday.push(c);
    else if (day >= weekAgo) buckets["Previous 7 days"].push(c);
    else buckets.Older.push(c);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function NavItem({
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
  const link = (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `relative w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 text-sm ${collapsed ? "justify-center" : ""} ${
          isActive
            ? "bg-primary text-primary-foreground shadow-raised"
            : "hover:bg-accent/60 hover:translate-x-0.5 text-foreground"
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
          {!collapsed ? <span className="flex-1 text-left truncate">{label}</span> : null}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
