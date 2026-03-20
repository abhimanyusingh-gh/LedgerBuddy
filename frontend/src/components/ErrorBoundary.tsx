import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", color: "#0f172a", background: "#f6f6f8" }}>
          <div style={{ textAlign: "center", maxWidth: 420, padding: "2rem" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#1152d4", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1.2rem" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "1.5rem" }}>receipt_long</span>
            </div>
            <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.5rem", fontWeight: 800 }}>BillForge</h1>
            <p style={{ margin: "0 0 1.5rem", color: "#64748b", lineHeight: 1.5 }}>Something went wrong. Please reload the page to continue.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ border: 0, borderRadius: 10, padding: "0.7rem 1.5rem", background: "#1152d4", color: "#fff", fontSize: "1rem", fontWeight: 700, cursor: "pointer" }}
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
