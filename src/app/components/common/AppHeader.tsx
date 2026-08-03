import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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
 */
export function AppHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 min-w-0">
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
