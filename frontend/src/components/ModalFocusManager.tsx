import { useEffect } from 'react';

const DIALOG_SELECTOR = [
  '[role="dialog"][aria-modal="true"]:not([data-modal-focus-managed="true"])',
  '[role="alertdialog"][aria-modal="true"]:not([data-modal-focus-managed="true"])',
].join(', ');

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type IsolationSnapshot = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

const isVisible = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return !element.hidden
    && element.getAttribute('aria-hidden') !== 'true'
    && !element.closest('[hidden], [inert]')
    && style.display !== 'none'
    && style.visibility !== 'hidden';
};

const getActiveDialogs = () => (
  Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR))
    .filter(dialog => dialog.getAttribute('aria-hidden') !== 'true' && isVisible(dialog))
);

const getActiveDialog = () => getActiveDialogs().at(-1) || null;

const getFocusable = (dialog: HTMLElement) => (
  Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
);

const isolateDialog = (dialog: HTMLElement) => {
  const snapshots: IsolationSnapshot[] = [];
  const seen = new Set<HTMLElement>();
  const rememberAndHide = (element: HTMLElement, makeInert: boolean) => {
    if (seen.has(element)) return;
    seen.add(element);
    snapshots.push({
      element,
      inert: element.inert === true,
      ariaHidden: element.getAttribute('aria-hidden'),
    });
    if (makeInert) element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  };

  // Preserve pointer dismissal on a visual backdrop while removing it from
  // the accessibility tree. Keyboard containment is enforced separately.
  const modalLayer = dialog.parentElement;
  if (modalLayer && modalLayer !== document.body) {
    Array.from(modalLayer.children).forEach(sibling => {
      if (sibling !== dialog && sibling instanceof HTMLElement) {
        rememberAndHide(sibling, false);
      }
    });
  }

  // Inert every sibling branch up to <body>. This also works for legacy
  // dialogs rendered inside #root without making the dialog itself inert.
  let activeBranch: HTMLElement | null = modalLayer && modalLayer !== document.body
    ? modalLayer
    : dialog;
  while (activeBranch?.parentElement) {
    const parentElement: HTMLElement = activeBranch.parentElement;
    Array.from(parentElement.children).forEach(sibling => {
      if (
        sibling !== activeBranch
        && sibling instanceof HTMLElement
        && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)
      ) {
        rememberAndHide(sibling, true);
      }
    });
    if (parentElement === document.body) break;
    activeBranch = parentElement;
  }

  return () => {
    snapshots.reverse().forEach(({ element, inert, ariaHidden }) => {
      if (!element.isConnected) return;
      element.inert = inert;
      if (ariaHidden == null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', ariaHidden);
    });
  };
};

const getCloseControl = (dialog: HTMLElement) => {
  const explicit = dialog.querySelector<HTMLElement>('[data-modal-close]:not([disabled])');
  if (explicit) return explicit;

  const closeLabels = new Set([
    'close',
    'cancel',
    'fermer',
    'annuler',
    'إغلاق',
    'اغلاق',
    'إلغاء',
    'الغاء',
  ]);
  const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase() || '';
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    .find(button => (
      closeLabels.has(normalize(button.getAttribute('aria-label')))
      || closeLabels.has(normalize(button.textContent))
    )) || null;
};

/**
 * Adds a complete focus lifecycle to legacy dialogs. Self-managed portal
 * dialogs can opt out with data-modal-focus-managed="true".
 */
export default function ModalFocusManager() {
  useEffect(() => {
    const returnFocus = new WeakMap<HTMLElement, HTMLElement | null>();
    let currentDialog: HTMLElement | null = null;
    let restoreIsolation: () => void = () => undefined;
    let previousBodyOverflow: string | null = null;
    let reconcileQueued = false;
    let reconciling = false;

    const focusDialog = (dialog: HTMLElement) => {
      if (dialog.contains(document.activeElement)) return;
      const target = dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
      if (target && isVisible(target)) target.focus();
      else (getFocusable(dialog)[0] || dialog).focus();
    };

    const deactivateCurrent = (restorePreviousFocus: boolean) => {
      if (!currentDialog) return;
      const dialog = currentDialog;
      restoreIsolation();
      restoreIsolation = () => undefined;
      if (previousBodyOverflow != null) {
        document.body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = null;
      }
      if (dialog.dataset.modalManagerTabindex === 'true') {
        dialog.removeAttribute('tabindex');
        delete dialog.dataset.modalManagerTabindex;
      }
      currentDialog = null;

      if (restorePreviousFocus) {
        const previous = returnFocus.get(dialog);
        if (previous?.isConnected) previous.focus();
      }
    };

    const activateDialog = (dialog: HTMLElement) => {
      currentDialog = dialog;
      if (!returnFocus.has(dialog)) {
        returnFocus.set(
          dialog,
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
      }
      if (!dialog.hasAttribute('tabindex')) {
        dialog.tabIndex = -1;
        dialog.dataset.modalManagerTabindex = 'true';
      }
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      restoreIsolation = isolateDialog(dialog);
      queueMicrotask(() => {
        if (currentDialog === dialog && dialog.isConnected) focusDialog(dialog);
      });
    };

    const reconcile = () => {
      reconcileQueued = false;
      const nextDialog = getActiveDialog();
      if (nextDialog === currentDialog) return;

      reconciling = true;
      const previousDialog = currentDialog;
      const previousWasClosed = Boolean(
        previousDialog
        && (!previousDialog.isConnected || !getActiveDialogs().includes(previousDialog)),
      );
      deactivateCurrent(previousWasClosed);
      if (nextDialog) activateDialog(nextDialog);
      reconciling = false;
    };

    const queueReconcile = () => {
      if (reconcileQueued) return;
      reconcileQueued = true;
      queueMicrotask(reconcile);
    };

    const keepFocusInside = (event: FocusEvent) => {
      if (reconciling) return;
      const dialog = getActiveDialog();
      if (!dialog || dialog.contains(event.target as Node)) return;
      focusDialog(dialog);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = getActiveDialog();
      if (!dialog) return;

      if (event.key === 'Escape') {
        // POS and explicitly marked dialogs already own their Escape behavior.
        if (dialog.closest('.pos-shell') || dialog.dataset.modalNativeEscape === 'true') return;
        const closeControl = getCloseControl(dialog);
        if (closeControl) {
          event.preventDefault();
          closeControl.click();
          return;
        }
        const requestClose = new CustomEvent('modalrequestclose', {
          bubbles: true,
          cancelable: true,
        });
        dialog.dispatchEvent(requestClose);
        if (requestClose.defaultPrevented) event.preventDefault();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(queueReconcile);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal', 'aria-hidden'],
    });
    document.addEventListener('focusin', keepFocusInside);
    document.addEventListener('keydown', handleKeyDown);
    reconcile();

    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', keepFocusInside);
      document.removeEventListener('keydown', handleKeyDown);
      deactivateCurrent(true);
    };
  }, []);

  return null;
}
