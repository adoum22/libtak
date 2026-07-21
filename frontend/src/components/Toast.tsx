import { useCallback, useState, useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext, type Toast, type ToastContextType, type ToastType } from './ToastContext';

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const showToast = (type: ToastType, message: string, duration = 4000) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, type, message, duration }]);
    };

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const value: ToastContextType = {
        showToast,
        success: (msg) => showToast('success', msg),
        error: (msg) => showToast('error', msg),
        warning: (msg) => showToast('warning', msg),
        info: (msg) => showToast('info', msg),
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            {/* Toast Container */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none" aria-label="Notifications">
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
    const timerRef = useRef<number | null>(null);
    const startedAtRef = useRef(0);
    const remainingRef = useRef(toast.duration || 4000);

    const startTimer = useCallback(() => {
        startedAtRef.current = Date.now();
        timerRef.current = window.setTimeout(() => onClose(toast.id), remainingRef.current);
    }, [onClose, toast.id]);

    useEffect(() => {
        remainingRef.current = toast.duration || 4000;
        startTimer();
        return () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        };
    }, [startTimer, toast.duration]);

    const pauseTimer = () => {
        if (timerRef.current === null) return;
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    };

    const resumeTimer = () => {
        if (timerRef.current === null && remainingRef.current > 0) startTimer();
    };

    const icons = {
        success: <CheckCircle size={20} className="text-success" />,
        error: <XCircle size={20} className="text-danger" />,
        warning: <AlertTriangle size={20} className="text-warning" />,
        info: <Info size={20} className="text-accent" />,
    };

    const bgColors = {
        success: 'bg-success/10 border-success/30',
        error: 'bg-danger/10 border-danger/30',
        warning: 'bg-warning/10 border-warning/30',
        info: 'bg-accent/10 border-accent/30',
    };

    return (
        <div
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm animate-slideIn ${bgColors[toast.type]}`}
            style={{ minWidth: '280px', maxWidth: '400px' }}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            onMouseEnter={pauseTimer}
            onMouseLeave={resumeTimer}
            onFocusCapture={pauseTimer}
            onBlurCapture={resumeTimer}
        >
            {icons[toast.type]}
            <span className="flex-1 text-sm font-medium">{toast.message}</span>
            <button
                type="button"
                onClick={() => onClose(toast.id)}
                className="text-muted hover:text-foreground transition-colors"
                aria-label="Fermer la notification"
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
}
