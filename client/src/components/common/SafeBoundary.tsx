import { Component, ReactNode } from 'react';

type Props = { children: ReactNode, fallback?: ReactNode };
type State = { hasError: boolean };

export class SafeBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) {
    console.error('[ADMIN] Error caught by SafeBoundary:', err);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <div className="p-6">Something went wrong.</div>;
    }
    return this.props.children;
  }
}
