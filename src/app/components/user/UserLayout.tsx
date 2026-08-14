import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useIsMobile } from "../../lib/useIsMobile";
import { useChatExperience } from "../../lib/ChatExperienceContext";
import { useInstallPrompt } from "../../lib/useInstallPrompt";
import { UserAvatar } from "../common/UserAvatar";
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
  Pin,
  PinOff,
  Archive,
  Download,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { formatRoleLabel } from "../../lib/auth";
import { hasMultipleViews, WORKSPACE_VIEWS } from "../../lib/workspace";
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
import { listConversations, pinConversation, archiveConversation, type Conversation } from "../../lib/chatStore";

/**
 * Groups pathnames that belong to the same logical page so `AnimatePresence`
 * doesn't remount it on every sub-navigation. Without this, `key={pathname}`
 * force-unmounted UserChat the instant a new conversation got its `/chat/:id`
 * URL (which happens mid-send, on every first message) — killing the
 * in-flight request before the answer could render. Same risk applies to
 * the Business Hub workspace, whose secondary sidebar swaps `/distributor/
 * dashboard/<section>` without an intended full remount.
 */
function pageTransitionKey(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/chat/")) return "chat";
  if (pathname.startsWith("/distributor/dashboard")) return "business-hub";
  return pathname;
}

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
  // The Business Hub workspace has its own mobile top bar + section drawer
  // (BusinessHubShell), so the app-level mobile header and bottom tab bar
  // would otherwise stack on top of it — two hamburgers, two nav layers,
  // and less vertical room for actual content on a phone screen.
  const isBusinessHub = location.pathname.startsWith("/distributor/dashboard");
  const isChatRoute = location.pathname === "/" || location.pathname.startsWith("/chat/");
  const isMobile = useIsMobile();
  const { mode: chatExperienceMode } = useChatExperience();
  // On the chat screen in Professional mode, UserChat.tsx renders its own
  // single minimal mobile header (hamburger + title + New chat + •••) — so
  // this layout's generic mobile top bar and bottom tab bar both step aside
  // instead of stacking on top of it.
  const useChatOwnHeader = isMobile && isChatRoute && chatExperienceMode === "professional";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("dj-sidebar-collapsed") === "1");
  const { canInstall, promptInstall } = useInstallPrompt();
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

  const handlePinChat = async (id: string, pinned: boolean) => {
    setRecentChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    await pinConversation(id, pinned);
  };

  const handleArchiveChat = async (id: string) => {
    setRecentChats((prev) => prev.filter((c) => c.id !== id));
    await archiveConversation(id, true);
    if (location.pathname === `/chat/${id}`) navigate("/");
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dj-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  // Must match the `allowedRoles` on the /distributor/* routes in App.tsx
  // (["distributor", "leader", ...STAFF_ONLY]) — otherwise a role that can
  // open Business Hub by URL never sees the nav link to it at all.
  const canDistributor =
    role === "distributor" ||
    role === "leader" ||
    role === "trainer" ||
    role === "employee" ||
    role === "support" ||
    role === "admin" ||
    role === "management" ||
    role === "super_admin";

  const userInitials =
    currentUser?.email?.slice(0, 2).toUpperCase() ??
    currentUser?.user_metadata?.full_name?.slice(0, 2)?.toUpperCase() ??
    "DU";
  const userName =
    (currentUser?.user_metadata?.full_name as string | undefined) ||
    currentUser?.email?.split("@")[0] ||
    "Dayjoy User";
  const roleLabel = formatRoleLabel(role);

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
    { to: "/support", icon: LifeBuoy, label: "Support Centre", group: "Main" },
    ...(canDistributor
      ? [
          { to: "/distributor/dashboard", icon: LayoutDashboard, label: "Business Hub", group: "Business Hub" },
          { to: "/distributor/dashboard/team", icon: Users, label: "Business Hub — Team", group: "Business Hub" },
          { to: "/distributor/dashboard/customers", icon: Users, label: "Business Hub — Customers", group: "Business Hub" },
          { to: "/distributor/dashboard/follow-ups", icon: Clock, label: "Business Hub — Follow-ups", group: "Business Hub" },
          { to: "/distributor/dashboard/content", icon: Sparkles, label: "Business Hub — Content Generator", group: "Business Hub" },
          { to: "/distributor/dashboard/analytics", icon: BarChart3, label: "Business Hub — Analytics", group: "Business Hub" },
          { to: "/distributor/dashboard/ai-sales-coach", icon: Users, label: "Business Hub — AI Sales Coach", group: "Business Hub" },
          { to: "/distributor/dashboard/training", icon: GraduationCap, label: "Business Hub — Training", group: "Business Hub" },
        ]
      : []),
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
      {/* 100dvh, not 100vh: mobile browser chrome counts against vh, which
          pushed the drawer footer (profile / sign out) below the fold. */}
      <div className="h-[100dvh] flex bg-background">
        <a
          href="#dj-main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>

        {/* Mobile top bar. Kept even inside Business Hub — its hamburger is
            the only escape hatch back to primary nav (Chat, Products, Sign
            out, ...) on mobile, since Business Hub's own drawer only lists
            its sections. */}
        {!useChatOwnHeader ? (
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
        ) : null}

        {/* Mobile drawer overlay */}
        {drawerOpen ? (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        {/* Sidebar (also mobile drawer).
            Opaque `bg-card` as a mobile drawer — `glass` is 72% alpha, so page
            content read straight through the menu. The translucent treatment is
            kept for the static desktop rail, where it sits on the page
            background rather than over content. */}
        <aside
          id="dj-user-drawer"
          className={`fixed lg:static inset-y-0 left-0 z-[45] w-72 sm:w-80 ${collapsed ? "lg:w-[76px]" : "lg:w-72"} bg-card lg:glass border-r border-border flex flex-col transition-[transform,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
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
                  <p className="text-xs text-primary font-medium truncate">
                    {isBusinessHub ? WORKSPACE_VIEWS.distributor.portalName : WORKSPACE_VIEWS.customer.portalName}
                  </p>
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
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4" aria-label="Main">
            {/* Grouped into labeled sections instead of one flat list —
                a dozen same-weight icons in a row gives every destination
                equal visual importance, which makes the sidebar harder to
                scan than it needs to be. Collapsed (icon-only) mode drops
                the labels entirely, same as before. */}
            <NavGroup label={BRAND.shortName} collapsed={collapsed}>
              <NavItem to="/" icon={Plus} label="AI Chat" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/voice" icon={Mic} label="Voice Assistant" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
            </NavGroup>
            <NavGroup label="Explore" collapsed={collapsed}>
              <NavItem to="/products" icon={Package} label="Product Discovery" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/knowledge" icon={Search} label="Knowledge Center" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
            </NavGroup>
            <NavGroup label="Personal" collapsed={collapsed}>
              <NavItem to="/dashboard" icon={LayoutDashboard} label="My Dashboard" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/favorites" icon={Heart} label="Favorites" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              <NavItem to="/wellness" icon={Target} label="Wellness Journey" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              {canDistributor ? (
                // Sub-sections (Team, Customers, Follow-ups, Content, Analytics,
                // AI Sales Coach, ...) live inside the Business Hub workspace's
                // own secondary sidebar now — not duplicated here.
                <NavItem to="/distributor/dashboard" icon={LayoutDashboard} label="Business Hub" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
              ) : null}
            </NavGroup>
            <NavGroup label="Support" collapsed={collapsed} last>
              <NavItem to="/support" icon={LifeBuoy} label="Support Centre" collapsed={collapsed} onClick={() => setDrawerOpen(false)} />
            </NavGroup>

            {!collapsed && recentChats.length > 0 ? (
              <div className="pt-5">
                {groupChatsByDate(recentChats).map((group) => (
                  <div key={group.label} className="mb-2">
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    {group.items.map((c) => (
                      <div key={c.id} className="group relative flex items-center">
                        <NavLink
                          to={`/chat/${c.id}`}
                          onClick={() => setDrawerOpen(false)}
                          className="flex-1 min-w-0 flex items-center gap-1.5 truncate rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                        >
                          {c.pinned ? (
                            <Pin className="w-3 h-3 shrink-0 text-primary" aria-hidden="true" />
                          ) : null}
                          <span className="truncate">{c.title}</span>
                        </NavLink>
                        {/* A single ⋮ trigger, not permanently-visible pin
                            and archive icons on every row — those read as
                            visual noise (and on mobile, `max-lg:opacity-100`
                            meant they were ALWAYS on, not just hover-revealed
                            like the desktop behavior intended). Hidden until
                            hover/focus on desktop; on mobile it's dim but
                            tappable, one icon instead of two. */}
                        <div className="absolute right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-60 transition-opacity">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.preventDefault()}
                                className="p-1 rounded hover:bg-accent bg-card/95"
                                aria-label={`Options for ${c.title}`}
                              >
                                <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => handlePinChat(c.id!, !c.pinned)}>
                                {c.pinned ? (
                                  <PinOff className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                                ) : (
                                  <Pin className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                                )}
                                {c.pinned ? "Unpin" : "Pin"}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleArchiveChat(c.id!)}>
                                <Archive className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                                Archive
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
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
                  <UserAvatar user={currentUser} initials={userInitials} size={36} className="text-sm" />
                  {!collapsed ? (
                    <>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium truncate">{userName}</p>
                        <p className="text-xs text-muted-foreground">{roleLabel}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/60" aria-hidden="true" />
                    </>
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  {userName} · {roleLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { navigate("/profile"); setDrawerOpen(false); }}>Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { navigate("/settings"); setDrawerOpen(false); }}>Notifications</DropdownMenuItem>
                {canInstall ? (
                  <DropdownMenuItem onClick={() => void promptInstall()}>
                    <Download className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                    Install Dayjoy AI
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => { navigate("/settings"); setDrawerOpen(false); }}>Settings</DropdownMenuItem>
                {hasMultipleViews(role) ? (
                  <DropdownMenuItem onClick={() => navigate("/workspace", { state: { voluntary: true } })}>Switch View</DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { navigate("/support"); setDrawerOpen(false); }}>Help & Support</DropdownMenuItem>
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
          className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${useChatOwnHeader ? "pt-0" : "pt-14 lg:pt-0"} ${isBusinessHub || useChatOwnHeader ? "pb-0" : "pb-16 lg:pb-0"}`}
          tabIndex={-1}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={pageTransitionKey(location.pathname)}
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageTransition}
              className="flex-1 flex flex-col min-w-0 min-h-0"
            >
              <Outlet context={{ openDrawer: () => setDrawerOpen(true), professionalMobile: useChatOwnHeader }} />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom tab bar — hidden inside Business Hub (its own drawer
            already covers in-workspace navigation) and hidden on the chat
            screen in Professional mode (that screen is chat-first; the other
            3 destinations live in the hamburger drawer instead). */}
        {!isBusinessHub && !useChatOwnHeader ? (
        <nav
          // Below the drawer backdrop (z-40) so an open drawer covers the tab
          // bar instead of the two fighting at the same level.
          className="lg:hidden fixed inset-x-0 bottom-0 z-[35] grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
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
        ) : null}

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

/** One labeled section of the primary nav (e.g. "Explore", "Personal") — a
 * small uppercase heading above its items, matching the same pattern
 * already used for "Recent" conversation date groups below. Collapsed mode
 * drops the label and the section just becomes extra vertical spacing. */
function NavGroup({
  label,
  collapsed,
  last = false,
  children,
}: {
  label: string;
  collapsed: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={last ? "" : "mb-4"}>
      {!collapsed ? (
        <p className="text-[11px] font-semibold text-muted-foreground mb-1.5 px-3 uppercase tracking-wide">
          {label}
        </p>
      ) : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
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
