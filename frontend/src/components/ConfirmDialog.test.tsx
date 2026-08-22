import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../i18n';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('focuses the safe action and supports keyboard cancellation', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Désactiver ?"
        description="Cette donnée restera dans l’historique."
        cancelLabel="Annuler"
        confirmLabel="Confirmer"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const cancelButton = screen.getByRole('button', { name: 'Annuler' });
    const confirmButton = screen.getByRole('button', { name: 'Confirmer' });
    confirmButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancelButton).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirmButton).toHaveFocus();

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
