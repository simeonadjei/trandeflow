import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: "2rem", fontFamily: "monospace", color: "#f87171",
          background: "#0f1629", minHeight: "100vh", whiteSpace: "pre-wrap",
          wordBreak: "break-all"
        }}>
          <h2 style={{ color: "#ef4444", marginBottom: "1rem" }}>App Error</h2>
          <p style={{ color: "#fca5a5", marginBottom: "0.5rem" }}>{this.state.error.message}</p>
          <pre style={{ color: "#6b7280", fontSize: "0.75rem" }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
