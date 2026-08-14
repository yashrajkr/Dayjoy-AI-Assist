import type { SVGProps } from "react";
import { BRAND } from "../../lib/brand";
import { useTransparentLogo } from "../../lib/useTransparentLogo";
import logoSrc from "../../../assets/dayjoy-logo.png";

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
  // The source art is a flat PNG on solid black, background-keyed to
  // transparent client-side (see useTransparentLogo) so it can sit on any
  // surface. Falls back to the original vector mark until that's ready or
  // for "mono" (single-color, e.g. on the primary-colored mobile header).
  const transparentLogo = useTransparentLogo(logoSrc);

  if (variant === "mark") {
    if (transparentLogo) {
      return (
        <img
          src={transparentLogo}
          alt={`${BRAND.name} logo`}
          width={size}
          height={size}
          className={`object-contain ${className ?? ""}`}
          style={{ width: size, height: size }}
        />
      );
    }
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
      {transparentLogo ? (
        <img
          src={transparentLogo}
          alt=""
          width={size}
          height={size}
          className="object-contain shrink-0"
          style={{ width: size, height: size }}
        />
      ) : (
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
      )}
      <div className="flex flex-col leading-tight">
        {/* text-foreground (theme token), not the hardcoded BRAND.colors.foreground
            this used to inline-style with — that's a fixed dark-brown hex meant for
            light backgrounds, so the wordmark rendered near-invisible in dark mode. */}
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {BRAND.name}
        </span>
        {showTagline ? (
          <span className="text-[11px] text-muted-foreground">
            {BRAND.tagline}
          </span>
        ) : null}
      </div>
    </div>
  );
}
