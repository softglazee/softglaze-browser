import { Component } from 'react';
import { useTranslation } from 'react-i18next';

function Fallback({ error, onRetry }) {
  const { t } = useTranslation();
  const msg = String((error && error.message) || error || t('errorBoundary.unknown'));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="text-lg font-semibold">{t('errorBoundary.title')}</div>
      <div className="max-w-md text-sm opacity-70">{t('errorBoundary.body')}</div>
      <div className="max-w-md break-all text-xs opacity-50">{msg}</div>
      <button
        type="button"
        className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
        onClick={onRetry}
      >
        {t('errorBoundary.retry')}
      </button>
    </div>
  );
}

// Keeps the shell alive when a page throws during render, shows a recoverable fallback, and
// resets when resetKey (the route pathname) changes, so navigating away restores the page.
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
      return <Fallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
