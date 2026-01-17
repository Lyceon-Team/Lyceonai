import { useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

let TOASTER_MOUNTED = false;

export function UIProvider({ children }: { children: React.ReactNode }) {
  const boot = useRef(false);
  if (!boot.current) boot.current = true;

  return (
    <TooltipProvider delayDuration={150}>
      {children}
      {!TOASTER_MOUNTED && (() => { TOASTER_MOUNTED = true; return <Toaster/> })()}
    </TooltipProvider>
  );
}
