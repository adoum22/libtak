import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    busy?: boolean;
    tone?: 'danger' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    busy = false,
    tone = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const titleId = useId();
    const descriptionId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        cancelRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [busy, onCancel, open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
            <button
                type="button"
                className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
                aria-label="Fermer la confirmation"
                onClick={() => !busy && onCancel()}
            />
            <div
                className="relative card w-full max-w-md p-6 shadow-2xl animate-fadeScale"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
            >
                <div className="flex items-start gap-4">
                    <span className="shrink-0 rounded-full bg-danger-light p-3 text-danger" aria-hidden="true">
                        <AlertTriangle size={24} />
                    </span>
                    <div>
                        <h2 id={titleId} className="text-lg font-bold text-primary">{title}</h2>
                        <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted">{description}</p>
                    </div>
                </div>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                        ref={cancelRef}
                        type="button"
                        className="btn-secondary"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? 'Traitement…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
