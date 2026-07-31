import { Component, type ErrorInfo, type ReactNode } from "react";
import { BRAND } from "../../lib/brand";
import { DayjoyLogo } from "../brand/DayjoyLogo";

type Props = { children: ReactNode };
type State = { hasError: boolean; error?: Error };

/**
 * Global error boundary. Catches any uncaught render error in the
 * subtree and shows a branded fallback instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught render error:", error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: BRAND.colors.background }}
        role="alert"
        aria-live="assertive"
      >
        <div
          className="w-full max-w-lg rounded-3xl border p-8 text-center shadow-xl"
          style={{
            background: BRAND.colors.card,
            borderColor: BRAND.colors.border,
          }}
        >
          <div className="flex justify-center mb-4">
            <DayjoyLogo variant="mark" size={56} />
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: BRAND.colors.foreground }}>
            Something went wrong
          </h1>
          <p className="text-sm mb-6" style={{ color: BRAND.colors.muted }}>
            {BRAND.name} hit an unexpected error. Your data is safe. Try reloading — and if the
            problem persists, contact Dayjoy support.
          </p>

          {this.state.error && (
            <pre
              className="mb-4 max-h-48 overflow-auto rounded-xl p-3 text-left text-xs"
              style={{
                background: BRAND.colors.cardBeige,
                color: BRAND.colors.destructive,
              }}
            >
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-xl border text-sm font-medium hover:opacity-90"
              style={{
                background: BRAND.colors.card,
                color: BRAND.colors.foreground,
                borderColor: BRAND.colors.border,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90"
              style={{
                background: BRAND.colors.primary,
                color: BRAND.colors.primaryForeground,
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
