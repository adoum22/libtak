import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForNewVersion } from '../utils/reloadOnChunkError';
import { clearAuthSession } from '../api/client';
import i18n from '../i18n';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        if (import.meta.env.DEV) console.error('Uncaught error:', error, errorInfo);
        if (isChunkLoadError(error)) {
            void reloadOnceForNewVersion();
            return;
        }
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <main className="min-h-screen flex items-center justify-center bg-primary p-4">
                    <div className="bg-secondary p-8 rounded-lg shadow-xl max-w-2xl w-full" role="alert" aria-labelledby="fatal-error-title">
                        <h1 id="fatal-error-title" className="text-2xl font-bold text-danger mb-4">{i18n.t('FatalErrorTitle')}</h1>
                        <p className="mb-4 text-secondary">{i18n.t('FatalErrorMessage')}</p>

                        {import.meta.env.DEV && (
                            <details className="bg-tertiary p-4 rounded overflow-auto max-h-60 mb-6 border">
                                <summary className="font-semibold cursor-pointer">{i18n.t('TechnicalDetails')}</summary>
                                <p className="font-mono text-sm text-danger font-bold mt-2">
                                    {this.state.error?.toString()}
                                </p>
                                <pre className="font-mono text-xs text-muted mt-2">
                                    {this.state.errorInfo?.componentStack}
                                </pre>
                            </details>
                        )}

                        <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="btn-primary"
                        >
                            {i18n.t('ReloadApplication')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearAuthSession();
                                window.location.href = '/login';
                            }}
                            className="btn-secondary"
                        >
                            {i18n.t('ResetSession')}
                        </button>
                        </div>
                    </div>
                </main>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
