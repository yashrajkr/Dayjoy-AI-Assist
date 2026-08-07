import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../ui/button";

/**
 * Shared layout primitives for admin pages. Keeps typography, spacing,
 * and status visuals consistent across the admin routes.
 *
 * Built on top of the shared `ui/` primitives layer (`buttonVariants`) so
 * admin screens and the rest of the app render from one design system,
 * with a premium animation layer on top: spring hover-lift on cards,
 * sheen sweep, animated PageHeader entrance.
 */

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6"
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"
          >
            {icon}
          </motion.div>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </motion.header>
  );
}

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  if (!hover) {
    return (
      <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-flat", className)}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-flat sheen-hover", className)}
      whileHover={{ y: -3, boxShadow: "var(--shadow-overlay)" }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Button — the animated primary/secondary/ghost/danger action button used
 * across admin pages. Prefer this over the raw `btnClass` strings for any
 * new or touched code; it adds the standard hover/tap micro-interaction.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  onClick,
  disabled,
  type = "button",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  const uiVariant = { primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive" } as const;
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={cn(buttonVariants({ variant: uiVariant[variant], size: size === "sm" ? "sm" : "default" }), className)}
    >
      {children}
    </motion.button>
  );
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: "up" | "down" | "flat";
  icon?: ReactNode;
}) {
  const trendColor =
    trend === "up"
      ? "text-primary"
      : trend === "down"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <Card hover>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
          {hint ? <p className={`text-xs mt-1 ${trendColor}`}>{hint}</p> : null}
        </div>
        {icon ? (
          <div className="w-9 h-9 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            {icon}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-primary/10 text-primary",
  pending: "bg-warning/15 text-warning",
  rejected: "bg-destructive/10 text-destructive",
  open: "bg-warning/15 text-warning",
  in_progress: "bg-warning/15 text-warning",
  resolved: "bg-primary/10 text-primary",
  closed: "bg-muted text-muted-foreground",
  new: "bg-primary/10 text-primary",
  contacted: "bg-warning/15 text-warning",
  converted: "bg-primary/10 text-primary",
  lost: "bg-destructive/10 text-destructive",
  active: "bg-primary/10 text-primary",
  inactive: "bg-muted text-muted-foreground",
  safe: "bg-primary/10 text-primary",
  blocked: "bg-destructive/10 text-destructive",
};

export function StatusPill({ status }: { status: string }) {
  const cls = STATUS_STYLES[status.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="text-center py-12 px-4"
    >
      {icon ? (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
          className="inline-flex w-12 h-12 rounded-2xl bg-accent text-accent-foreground items-center justify-center mb-3"
        >
          {icon}
        </motion.div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </motion.div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    // min-h so `justify-center` actually has room to center against —
    // without it the spinner just sat at the top of whatever (often tall)
    // column it was placed in instead of the middle of the visible area.
    <div className="flex flex-col items-center justify-center gap-3 py-12 min-h-[50vh]">
      <div className="relative w-10 h-10">
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-primary/20"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          style={{ borderTopColor: "var(--primary)" }}
        />
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {message}
    </div>
  );
}

/** Primary / secondary button styles for admin pages. */
export const btnClass = {
  primary:
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium transition-all duration-200 hover:bg-accent/60 hover:border-primary/20 active:scale-[0.97] disabled:opacity-50",
  ghost:
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:bg-accent/60 active:scale-[0.97]",
  danger:
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-[0.97]",
  size: { sm: "px-2.5 py-1 text-xs" },
};
