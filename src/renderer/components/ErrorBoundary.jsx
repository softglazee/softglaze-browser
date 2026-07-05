import { Component } from 'react';

// audit: the renderer had NO error boundary anywhere, so ANY page's render
// exception unmounted the whole React root and blanked the entire app until a
// relaunch (a partial settings payload in GlobalPreferences was one concrete
// trigger). This catches render errors below it, keeps the app shell/sidebar
// alive, shows a recoverable fallback, and auto-resets when `resetKey` changes
// (the caller passes the route pathname) so navigating away restores the page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try { console.error('[ErrorBoundary]', error, info && info.componentStack); } catch (e) { /* ignore */ }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const msg = String((this.state.error && this.state.error.message) || this.state.error || 'Unknown error');
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-12 text-center">
          <div className="text-lg font-semibold">Something went wrong on this page.</div>
          <div className="max-w-md text-sm opacity-70">
            The rest of the app is still running — try again, or open another page from the sidebar.
          </div>
          <div className="max-w-md break-all text-xs opacity-50">{msg}</div>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
