import { useRef } from "react";
import { Toaster } from "@/components/ui/toaster";

let TOASTER_MOUNTED = false;

export function UIProvider({ children }: { children: React.ReactNode }) {
  const boot = useRef(false);
  if (!boot.current) boot.current = true;

  return (
    <>
      {children}
      {!TOASTER_MOUNTED && (() => { TOASTER_MOUNTED = true; return <Toaster/> })()}
    </>
  );
}
