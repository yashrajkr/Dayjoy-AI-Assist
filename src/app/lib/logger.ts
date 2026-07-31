/**
 * Production-safe logger.
 *
 * In production (import.meta.env.PROD), only `error` calls are emitted —
 * `log`, `info`, `debug`, and `warn` are silenced to keep the browser
 * console clean for end users.
 *
 * In development, all levels are emitted with a `[Dayjoy]` prefix for
 * easy filtering in browser DevTools.
 *
 * Usage:
 *   import { logger } from "../lib/logger";
 *   logger.warn("[chat] send failed", e);
 *   logger.error("[boundary] crashed", error);
 */

const isProd = typeof import.meta !== "undefined" && import.meta.env?.PROD;
const PREFIX = "[Dayjoy]";

type LogArgs = unknown[];

function format(args: LogArgs): LogArgs {
  if (args.length === 0) return args;
  const first = args[0];
  if (typeof first === "string") {
    return [`${PREFIX} ${first}`, ...args.slice(1)];
  }
  return [PREFIX, ...args];
}

export const logger = {
  /** Verbose debug log — silenced in production. */
  debug: (...args: LogArgs) => {
    if (isProd) return;
    console.debug(...format(args));
  },
  /** Info log — silenced in production. */
  info: (...args: LogArgs) => {
    if (isProd) return;
    console.info(...format(args));
  },
  /** Standard log — silenced in production. */
  log: (...args: LogArgs) => {
    if (isProd) return;
    console.log(...format(args));
  },
  /** Warning — silenced in production but captured by error-tracking if wired. */
  warn: (...args: LogArgs) => {
    if (isProd) return;
    console.warn(...format(args));
  },
  /** Error — always emitted (even in production). */
  error: (...args: LogArgs) => {
    console.error(...format(args));
    // Future: forward to Sentry / LogRocket / Datadog here.
  },
};
