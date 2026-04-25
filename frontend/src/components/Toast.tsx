import { useState, useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext, type Toast, type ToastContextType, type ToastType } from './ToastContext';

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const showToast = (type: ToastType, message: string, duration = 4000) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, type, message, duration }]);
    };

    const removeToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

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
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, toast.duration || 4000);
        return () => clearTimeout(timer);
    }, [toast.duration, onClose]);

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
        >
            {icons[toast.type]}
            <span className="flex-1 text-sm font-medium">{toast.message}</span>
            <button
                onClick={onClose}
                className="text-muted hover:text-foreground transition-colors"
            >
                <X size={16} />
            </button>
        </div>
    );
}
