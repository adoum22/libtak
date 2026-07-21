import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useBarcodeScanner from './useBarcodeScanner';

function ScannerHarness({ onScan }: { onScan: (value: string) => void }) {
  useBarcodeScanner(onScan);
  return <input aria-label="manual search" />;
}

describe('useBarcodeScanner', () => {
  it('emits a rapid keyboard scan terminated by Enter', () => {
    const onScan = vi.fn();
    render(<ScannerHarness onScan={onScan} />);

    for (const key of '9781234567890') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onScan).toHaveBeenCalledWith('9781234567890');
  });

  it('does not intercept typing in an editable field', () => {
    const onScan = vi.fn();
    const { getByRole } = render(<ScannerHarness onScan={onScan} />);
    const input = getByRole('textbox', { name: 'manual search' });

    for (const key of '12345') fireEvent.keyDown(input, { key });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onScan).not.toHaveBeenCalled();
  });
});
