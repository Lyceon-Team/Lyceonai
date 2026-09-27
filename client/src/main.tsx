import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";

declare global {
  interface Window {
    __BUILD__?: string;
  }
}

window.__BUILD__ = `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
console.log("[Build]", window.__BUILD__);

// Microsoft Clarity was initialised here, before the router, with no options object —
// session recording and heatmaps on by vendor default, including on /chat and /tutor. It
// was dark only because its project-id env var happened to be unset, which is one dashboard
// setting away from recording minors. That variable is now named nowhere in source, so the
// accident cannot be undone by setting an env var.
//
// Its consent setter had zero call sites and kept its flag in localStorage, so it could not
// have evidenced consent even if a UI had called it. And Microsoft is named nowhere in the
// legal corpus, while Trust & Safety promises that every provider which processes your data
// is named in the Privacy Policy.
//
// Removed 2026-09-21 (Phase 7 Part B). Vercel Analytics stays, mounted in App.tsx:
// page-level, not session replay, and now disclosed in Privacy Policy v3 §6.6 and §5.2.

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
