import type { SVGProps } from "react";
import { BRAND } from "../../lib/brand";

/**
 * DayjoyLogo — official mark for Dayjoy AI Assist.
 *
 * A speech bubble (AI conversation) cradling two chat lines (approved knowledge)
 * plus a leaf accent (wellness / agriculture / lifestyle roots of Dayjoy).
 *
 * Variants:
 *  - `full` (default): logo + wordmark "Dayjoy AI Assist"
 *  - `mark`: just the rounded logo square, no wordmark
 *  - `mono`: single-color (currentColor) for dark backgrounds
 */
export type DayjoyLogoProps = SVGProps<SVGSVGElement> & {
  variant?: "full" | "mark" | "mono";
  size?: number;
  showTagline?: boolean;
};

export function DayjoyLogo({
  variant = "full",
  size = 40,
  showTagline = false,
  className,
  ...rest
}: DayjoyLogoProps) {
  const primary = variant === "mono" ? "currentColor" : BRAND.colors.primary;
  const foreground = variant === "mono" ? "currentColor" : BRAND.colors.primaryForeground;
  const gold = BRAND.colors.goldAccent;

  if (variant === "mark") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${BRAND.name} logo`}
        className={className}
        {...rest}
      >
        <rect width="64" height="64" rx="14" fill={primary} />
        <path
          d="M32 14c-9.4 0-17 7.4-17 16.6 0 5.2 2.4 9.8 6.2 12.9V48l5.4-3c1.7.4 3.5.6 5.4.6 9.4 0 17-7.4 17-16.6S41.4 14 32 14z"
          fill={foreground}
        />
        <path
          d="M24 30c4-1.3 8-1.3 12 0M24 35c4-1 8-1 12 0"
          stroke={primary}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M40 40c2 4 6 6 10 6-1-3-2-6-4-8-2-2-4-3-6-2z" fill={gold} />
      </svg>
    );
  }

  if (variant === "mono") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${BRAND.name} logo`}
        className={className}
        {...rest}
      >
        <rect width="64" height="64" rx="14" fill={primary} />
        <path
          d="M32 14c-9.4 0-17 7.4-17 16.6 0 5.2 2.4 9.8 6.2 12.9V48l5.4-3c1.7.4 3.5.6 5.4.6 9.4 0 17-7.4 17-16.6S41.4 14 32 14z"
          fill={foreground}
        />
      </svg>
    );
  }

  // full: logo + wordmark
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`} {...(rest as object)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${BRAND.name} logo`}
      >
        <rect width="64" height="64" rx="14" fill={primary} />
        <path
          d="M32 14c-9.4 0-17 7.4-17 16.6 0 5.2 2.4 9.8 6.2 12.9V48l5.4-3c1.7.4 3.5.6 5.4.6 9.4 0 17-7.4 17-16.6S41.4 14 32 14z"
          fill={foreground}
        />
        <path
          d="M24 30c4-1.3 8-1.3 12 0M24 35c4-1 8-1 12 0"
          stroke={primary}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M40 40c2 4 6 6 10 6-1-3-2-6-4-8-2-2-4-3-6-2z" fill={gold} />
      </svg>
      <div className="flex flex-col leading-tight">
        <span
          className="text-[15px] font-semibold tracking-tight"
          style={{ color: BRAND.colors.foreground }}
        >
          {BRAND.name}
        </span>
        {showTagline ? (
          <span className="text-[11px]" style={{ color: BRAND.colors.muted }}>
            {BRAND.tagline}
          </span>
        ) : null}
      </div>
    </div>
  );
}
