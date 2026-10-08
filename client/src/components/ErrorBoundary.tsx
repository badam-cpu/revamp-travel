import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary. Shows a calm, on-brand fallback to users and NEVER
 * renders internal error details (message / stack) to an external visitor — the
 * technical details go to the console for developers only, and a stack is shown
 * on screen ONLY in a dev build (import.meta.env.DEV), never in production.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Developer-facing only — console, not the UI.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-paper p-8 text-basalt">
          <div className="flex max-w-md flex-col items-center text-center">
            <span className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-apricot/10 text-apricot">
              <AlertTriangle className="h-7 w-7" />
            </span>
            <h1 className="font-display text-3xl tracking-[-0.02em]">Something went wrong.</h1>
            <p className="mt-3 text-sm leading-6 text-basalt/60">
              We hit a snag loading this page. Reloading usually fixes it. If it keeps happening, email us at{" "}
              <a href="mailto:hello@revampvacations.com" className="font-semibold text-apricot hover:underline">hello@revampvacations.com</a>.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-none bg-apricot px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-apricot/90"
              >
                <RotateCcw className="h-4 w-4" /> Reload page
              </button>
              <a
                href="/"
                className="inline-flex items-center gap-2 rounded-none border border-basalt/15 px-5 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
              >
                Go to homepage
              </a>
            </div>

            {/* Dev-only diagnostics — stripped from production builds, so a real
                visitor never sees a stack trace. */}
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-8 max-h-64 w-full overflow-auto rounded bg-basalt/5 p-4 text-left text-xs text-basalt/60 whitespace-break-spaces">
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
