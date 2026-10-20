import { useRef } from 'react';

type FocusEventHandler = (event: Event) => void;

/**
 * Radix returns focus only to a `Trigger`. Our dialogs are opened by ordinary buttons (often from a
 * row menu or a state change), so remember whatever had focus when the panel opened and give focus
 * back to it when the panel closes, if it is still on the page.
 */
export function useRestoreFocus(handlers: {
  onOpenAutoFocus?: FocusEventHandler | undefined;
  onCloseAutoFocus?: FocusEventHandler | undefined;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      opener.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      handlers.onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = opener.current;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
