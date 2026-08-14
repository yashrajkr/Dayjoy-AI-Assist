import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { AppHeader } from "../../common/AppHeader";

/**
 * Shared primitives for the redesigned Settings area: a compact grouped-row
 * list on the index page, plus a consistent full-screen detail shell for
 * each settings subpage. Deliberately not `Card`-based (see `AdminUI.tsx`)
 * — Settings uses one bordered list per section instead of a card per row.
 */

export function SettingsSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label ? (
        <h2 className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h2>
      ) : null}
      <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({
  icon: Icon,
  label,
  value,
  description,
  onClick,
  href,
  chevron = true,
  danger = false,
  leading,
}: {
  icon?: LucideIcon;
  label: string;
  /** Short current-value text shown right-aligned, e.g. "English", "Light". */
  value?: string;
  /** Muted helper line shown under the label instead of a value. */
  description?: string;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  danger?: boolean;
  /** Custom element in place of the icon box (e.g. an avatar). */
  leading?: ReactNode;
}) {
  const interactive = Boolean(onClick || href);
  const Tag = href ? "a" : "button";

  return (
    <Tag
      type={href ? undefined : "button"}
      href={href}
      onClick={onClick}
      disabled={!interactive && Tag === "button" ? true : undefined}
      className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors ${
        interactive ? "hover:bg-accent/50 active:bg-accent/70" : ""
      } ${danger ? "text-destructive" : ""}`}
    >
      {leading ? (
        leading
      ) : Icon ? (
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            danger ? "bg-destructive/10" : "bg-accent"
          }`}
          aria-hidden="true"
        >
          <Icon className={`w-4 h-4 ${danger ? "text-destructive" : "text-primary"}`} />
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] sm:text-base font-medium leading-tight truncate ${danger ? "text-destructive" : ""}`}>
          {label}
        </p>
        {description ? (
          <p className="text-[13px] text-muted-foreground mt-0.5 truncate">{description}</p>
        ) : null}
      </div>
      {value ? (
        <span className="text-[13px] text-muted-foreground shrink-0 max-w-[40%] truncate">{value}</span>
      ) : null}
      {chevron && interactive && !danger ? (
        <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
      ) : null}
    </Tag>
  );
}

/** Full-screen shell for a settings detail subpage — header + back button + scroll body. */
export function SettingsDetailShell({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader title={title} subtitle={subtitle} icon={icon} showBackButton />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function SettingsHint({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground leading-relaxed">{children}</p>;
}
