import { useEffect, useState } from 'react';

export default function useBarcodeScanner(onScan: (barcode: string) => void) {
    const [barcode, setBarcode] = useState('');

    useEffect(() => {
        let timeout: any;

        const handleKeyDown = (e: KeyboardEvent) => {
            // If the event is from an input field, ignore it (unless it's the scanner acting as keyboard)
            // But usually scanner sends keys rapidly.
            // We'll assume scanner ends with Enter.

            if (e.key === 'Enter') {
                if (barcode) {
                    onScan(barcode);
                    setBarcode('');
                }
            } else if (e.key.length === 1) {
                setBarcode(prev => prev + e.key);

                // Clear buffer if too slow (manual typing vs scanner)
                clearTimeout(timeout);
                timeout = setTimeout(() => setBarcode(''), 100);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            clearTimeout(timeout);
        };
    }, [barcode, onScan]);
}
