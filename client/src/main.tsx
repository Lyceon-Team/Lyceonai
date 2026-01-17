import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";

import clarity from "@microsoft/clarity";

declare global {
  interface Window {
    __BUILD__?: string;
    __lyceonSetAnalyticsConsent?: (allowed: boolean) => void;
    __lyceonAnalyticsConsent?: boolean;
    __lyceonClarityInited?: boolean;
  }
}

window.__BUILD__ = `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
console.log("[Build]", window.__BUILD__);

function readAnalyticsConsent(): boolean {
  if (typeof window.__lyceonAnalyticsConsent === "boolean") return window.__lyceonAnalyticsConsent;

  try {
    return localStorage.getItem("lyceon_analytics_consent") === "true";
  } catch {
    return false;
  }
}

function writeAnalyticsConsent(allowed: boolean) {
  try {
    localStorage.setItem("lyceon_analytics_consent", allowed ? "true" : "false");
  } catch {
    // ignore
  }
  window.__lyceonAnalyticsConsent = allowed;
}

function initClarityIfAllowed() {
  const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
  if (!projectId) return;

  // Only run in production builds
  if (import.meta.env.MODE !== "production") return;

  // Only init once
  if (window.__lyceonClarityInited) return;

  // Only init after consent
  if (!readAnalyticsConsent()) return;

  clarity.init(projectId);
  window.__lyceonClarityInited = true;
}

// Make the setter hard to clobber
Object.defineProperty(window, "__lyceonSetAnalyticsConsent", {
  value: (allowed: boolean) => {
    writeAnalyticsConsent(allowed);
    if (allowed) initClarityIfAllowed();
  },
  writable: false,
  configurable: false,
});

// Attempt init on boot (no-op unless prod + consent true)
initClarityIfAllowed();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

