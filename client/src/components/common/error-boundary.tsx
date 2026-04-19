import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(e: any, info: any) {
    console.error("UI ErrorBoundary:", e, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="p-4 rounded-lg border border-border/70 bg-card text-foreground"
          data-testid="error-boundary"
        >
          Something went wrong. Please reload.
        </div>
      );
    }
    return this.props.children;
  }
}
