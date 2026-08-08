import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AccountMenu } from "./AccountMenu";

/**
 * AppHeader — shared top utility bar for every authenticated page.
 *
 * Distinct from `PageHeader` in `common/AdminUI.tsx` (an in-content section
 * title used inside admin pages) — this is the persistent top bar: icon +
 * title + optional subtitle on the left so the current page is always
 * unambiguous, plus page-specific actions, the notification bell, theme
 * toggle, and user avatar on the right (consistent across every page —
 * these no longer live in the sidebar footer).
 *
 * `onBack` (or plain `showBackButton`, defaulting to browser history -1):
 * only pass this for pages reached via a secondary action (a dropdown menu
 * item, a handoff link) rather than a primary sidebar/tab destination —
 * those already have a persistent, one-tap way back via nav, and a second
 * back control would be redundant there.
 */
export function AppHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  onBack,
  showBackButton,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  onBack?: () => void;
  showBackButton?: boolean;
}) {
  const navigate = useNavigate();
  const backHandler = onBack ?? (showBackButton ? () => navigate(-1) : undefined);

  return (
    <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        {backHandler ? (
          <button
            type="button"
            onClick={backHandler}
            className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors shrink-0"
            aria-label="Go back"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : null}
        {Icon ? (
          <div className="w-8 h-8 rounded-lg bg-accent text-primary flex items-center justify-center shrink-0" aria-hidden="true">
            <Icon className="w-4 h-4" />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-semibold truncate leading-tight">{title}</h1>
          {subtitle ? (
            <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {actions}
        <LanguageSwitcher className="hidden sm:inline-flex" />
        <NotificationCenter />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}
