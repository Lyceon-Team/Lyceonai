import { useEffect } from "react";

type Handler = (ev: KeyboardEvent) => void;

export function useShortcuts(map: Record<string, Handler>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName;
      const isEditable = target.isContentEditable;
      
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        isEditable
      ) {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (map[key]) map[key](e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
