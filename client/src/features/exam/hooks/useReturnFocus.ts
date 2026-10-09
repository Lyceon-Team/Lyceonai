/**
 * Focus goes back to whatever opened a dialog.
 *
 * @spec [E7b brief, accessibility: "navigator and review page fully keyboard-
 *        operable"] | @implemented [2026-09-25]
 *
 * plain English: Radix returns focus only to a <DialogTrigger>. The exam's dialogs
 * are opened from the footer, the review page or a timeout, so without this a
 * closed dialog drops focus on <body> and a keyboard user starts over from the top
 * of the page. The element focused when the dialog opens is remembered and
 * re-focused when it closes. (Found by the keyboard-only e2e walk.)
 */
import { useRef } from "react";

export function useReturnFocus(): {
  onOpenAutoFocus: () => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      // Runs before Radix moves focus inside: activeElement is still the opener.
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const target = opener.current;
      if (target !== null && target.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
