import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
    confirmLabel,
    cancelLabel,
    busy = false,
    tone = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const descriptionId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        const appRoot = document.getElementById('root');
        const previousRootAriaHidden = appRoot?.getAttribute('aria-hidden');
        document.body.style.overflow = 'hidden';
        if (appRoot) {
            appRoot.inert = true;
            appRoot.setAttribute('aria-hidden', 'true');
        }
        cancelRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) {
                event.preventDefault();
                onCancel();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) || []);
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current?.focus();
                return;
            }
            const first = focusable[0]!;
            const last = focusable[focusable.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            if (appRoot) {
                appRoot.inert = false;
                if (previousRootAriaHidden == null) appRoot.removeAttribute('aria-hidden');
                else appRoot.setAttribute('aria-hidden', previousRootAriaHidden);
            }
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [busy, onCancel, open]);

    if (!open) return null;

    return createPortal((
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
            <button
                type="button"
                className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
                aria-label={t('CloseConfirmation')}
                onClick={() => !busy && onCancel()}
            />
            <div
                ref={dialogRef}
                className="relative card w-full max-w-md p-6 shadow-2xl animate-fadeScale"
                role="alertdialog"
                tabIndex={-1}
                aria-modal="true"
                data-modal-focus-managed="true"
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
                        {cancelLabel || t('Cancel')}
                    </button>
                    <button
                        type="button"
                        className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? t('Processing') : (confirmLabel || t('Confirm'))}
                    </button>
                </div>
            </div>
        </div>
    ), document.body);
}
