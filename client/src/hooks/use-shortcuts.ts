import { useEffect } from "react";

type Handler = (ev: KeyboardEvent) => void;

export function useShortcuts(map: Record<string, Handler>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditableElement = (el: HTMLElement | null) =>
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if (isEditableElement(target) || isEditableElement(activeElement)) {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (map[key]) map[key](e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
