import { Component, type ErrorInfo, type ReactNode } from "react";
import { MissingActiveClientOrgError } from "@/api/errors";

interface MissingRealmBoundaryProps {
  children: ReactNode;
}

interface MissingRealmBoundaryState {
  caughtPath: string | null;
}

export class MissingRealmBoundary extends Component<
  MissingRealmBoundaryProps,
  MissingRealmBoundaryState
> {
  constructor(props: MissingRealmBoundaryProps) {
    super(props);
    this.state = { caughtPath: null };
  }

  static getDerivedStateFromError(error: unknown): MissingRealmBoundaryState | null {
    if (error instanceof MissingActiveClientOrgError) {
      return { caughtPath: error.requestPath };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof MissingActiveClientOrgError) {
      console.warn(
        "MissingRealmBoundary caught MissingActiveClientOrgError:",
        error.requestPath,
        info.componentStack
      );
    }
  }

  render(): ReactNode {
    if (this.state.caughtPath !== null) {
      return (
        <div
          data-testid="missing-realm-overlay"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Inter', sans-serif",
            color: "var(--ink)",
            background: "var(--bg-main)"
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 420, padding: "2rem" }}>
            <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.5rem", fontWeight: 800 }}>
              Select a client to continue
            </h1>
            <p style={{ margin: "0 0 1.5rem", color: "var(--ink-soft)", lineHeight: 1.5 }}>
              This area requires an active client organization. Pick a client from the
              realm switcher in the top bar, then retry.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 0,
                borderRadius: 10,
                padding: "0.7rem 1.5rem",
                background: "var(--accent)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
