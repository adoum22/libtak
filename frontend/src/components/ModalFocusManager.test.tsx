import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ModalFocusManager from './ModalFocusManager';

describe('ModalFocusManager', () => {
  it('keeps keyboard focus inside the active dialog', () => {
    render(
      <>
        <ModalFocusManager />
        <button type="button">Arrière-plan</button>
        <div role="dialog" aria-modal="true" aria-label="Test" tabIndex={-1}>
          <button type="button">Premier</button>
          <button type="button">Dernier</button>
        </div>
      </>,
    );

    const background = screen.getByText('Arrière-plan');
    const first = screen.getByRole('button', { name: 'Premier' });
    const last = screen.getByRole('button', { name: 'Dernier' });

    background.focus();
    expect(first).toHaveFocus();
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('focuses a newly opened dialog, isolates the background, and restores focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <ModalFocusManager />
          <main>
            <button type="button" onClick={() => setOpen(true)}>Ouvrir</button>
            {open && (
              <div role="presentation">
                <div role="dialog" aria-modal="true" aria-label="Edition">
                  <button type="button">Champ initial</button>
                  <button type="button" data-modal-close onClick={() => setOpen(false)}>Fermer</button>
                </div>
              </div>
            )}
          </main>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    trigger.focus();
    fireEvent.click(trigger);

    const initial = await screen.findByRole('button', { name: 'Champ initial' });
    await waitFor(() => expect(initial).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-hidden', 'true');
    expect(trigger.inert).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).not.toHaveAttribute('aria-hidden');
    expect(trigger.inert).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('uses an unambiguous localized cancel action for legacy dialogs', async () => {
    function LegacyHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <ModalFocusManager />
          {open && (
            <div role="dialog" aria-modal="true" aria-label="Ancienne modale">
              <button type="button">Continuer</button>
              <button type="button" onClick={() => setOpen(false)}>Annuler</button>
            </div>
          )}
        </>
      );
    }

    render(<LegacyHarness />);
    await screen.findByRole('dialog', { name: 'Ancienne modale' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves explicitly self-managed dialogs alone', async () => {
    render(
      <>
        <ModalFocusManager />
        <button type="button">Arrière-plan autonome</button>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Autonome"
          data-modal-focus-managed="true"
        >
          <button type="button">Action autonome</button>
        </div>
      </>,
    );

    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Arrière-plan autonome' })).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');
  });
});
