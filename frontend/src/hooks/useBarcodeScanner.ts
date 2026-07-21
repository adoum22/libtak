import { useEffect, useRef } from 'react';

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable
        || target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT';
};

export default function useBarcodeScanner(onScan: (barcode: string) => void) {
    const callbackRef = useRef(onScan);
    const bufferRef = useRef('');
    const lastKeyAtRef = useRef(0);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        callbackRef.current = onScan;
    }, [onScan]);

    useEffect(() => {
        const clearBuffer = () => {
            bufferRef.current = '';
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }
            if (event.key === 'Enter') {
                const barcode = bufferRef.current.trim();
                clearBuffer();
                if (barcode.length >= 3) void callbackRef.current(barcode);
                return;
            }
            if (event.key.length !== 1) return;

            const now = performance.now();
            if (now - lastKeyAtRef.current > 120) bufferRef.current = '';
            lastKeyAtRef.current = now;
            bufferRef.current += event.key;
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
            timeoutRef.current = window.setTimeout(clearBuffer, 180);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            clearBuffer();
        };
    }, []);
}
