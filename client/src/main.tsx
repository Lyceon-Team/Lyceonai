import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { captureFirstTouch } from "./lib/analytics/first-touch";
import "./index.css";
// @spec [Coding Standards §11; student-ui register UI-11] | @implemented [2026-09-29] |
// plain English: the math stylesheet is no longer imported here. MathRenderer.tsx imports it
// itself, and every math surface (practice, review, exam, tutor thread, reference sheet)
// renders through MathRenderer, so the stylesheet now ships in the lazy chunk that needs it
// instead of blocking first paint on every page.

declare global {
  interface Window {
    __BUILD__?: string;
  }
}

// The build stamp stays readable as `window.__BUILD__`; it is no longer printed, because
// Coding Standards §16 bans console.log in product code.
window.__BUILD__ = `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

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
// Removed 2026-09-21 (Phase 7 Part B). Vercel Analytics, which stayed then, was retired
// 2026-10-05 (SEO F10, SCL-201). Analytics is now PostHog, started only after cookie consent
// from `client/src/lib/analytics/posthog-client.ts` — never from here.

// SCL-201 IS 6: read the landing address and referrer before the router can change the URL.
// No network. Kept in sessionStorage only once analytics is accepted (first-touch.ts); until
// then, memory only — so it is safe to run before consent is known.
captureFirstTouch();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
