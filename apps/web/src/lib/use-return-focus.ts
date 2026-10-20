import { useRef } from 'react';

interface ReturnFocusHandlers {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * Remembers what had focus at the moment a dialog or panel opens, and gives focus back to it when it
 * closes. Radix only does this for a `Trigger`; this application opens its dialogs from page state, so
 * without this keyboard and screen-reader users would be dropped at the top of the page after every
 * dialog. The opener is read in `onOpenAutoFocus`, which fires just before focus moves into the dialog
 * (not at first render: the dialog component renders while closed too).
 */
export function useReturnFocus(): ReturnFocusHandlers {
  const opener = useRef<Element | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement;
    },
    onCloseAutoFocus: (event) => {
      const element = opener.current;
      if (
        element instanceof HTMLElement &&
        element !== document.body &&
        document.contains(element)
      ) {
        event.preventDefault();
        element.focus();
      }
      opener.current = null;
    },
  };
}
