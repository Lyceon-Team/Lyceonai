/**
 * The ONE browser module that loads PostHog.
 *
 * @spec [SCL-201 IS 1–2 (browser posthog-js on PostHog's standard defaults; cookieless — here,
 *       absent — until consent; never `identify` / `alias`; this module is the only importer);
 *       SCL-204 / R32 (session replay on PostHog's defaults; `ph-no-capture` on the question/answer
 *       areas and the LISA conversation — applied in those components, not here); owner Step 0
 *       decisions 2026-10-05: 1 (nothing loads or sends before Accept), 5 (scrub the guardian link
 *       code in before_send), 6 (US region)] | @implemented [2026-10-05]
 *
 * plain English: `startAnalytics()` is called only by AnalyticsConsentRoot, only after the visitor
 * accepted and only when the signed-in account (if any) is known to be 13 or over. posthog-js is
 * a DYNAMIC import, so before Accept its code is not even downloaded — "Reject = zero requests"
 * holds for the SDK itself, not just for events. Configuration is PostHog's dated defaults plus:
 *   - `person_profiles: "identified_only"` with no `identify` anywhere, so browser events stay
 *     anonymous and are never joined to the server's analytics_user_id;
 *   - `before_send` scrubbing credential-shaped URL parameters (url-scrub.ts).
 *   - `mask_all_text` while a signed-in surface is mounted (owner ruling 2026-10-05, SCL-213 IS 6):
 *     autocapture records no element text there; public pages keep the default.
 * Session recording follows the PROJECT setting, which stays off until F15 ships (decision 4).
 *
 * `stopAnalytics()` (withdrawal, or an excluded account signing in) opts out, stops recording,
 * deletes PostHog's cookies and storage, and reloads, so no SDK instance outlives the choice.
 */
import type { PostHog } from "posthog-js";
import { scrubProperties } from "./url-scrub";

/** PostHog's dated defaults snapshot ("standard defaults", R32). */
const POSTHOG_DEFAULTS = "2026-08-30" as const;

let instance: PostHog | null = null;
let starting: Promise<void> | null = null;

function config(): { key: string; host: string } | null {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (typeof key !== "string" || key.length === 0) return null;
  const host = import.meta.env.VITE_POSTHOG_HOST;
  return {
    key,
    host:
      typeof host === "string" && host.length > 0
        ? host
        : "https://us.i.posthog.com",
  };
}

/**
 * Owner ruling 2026-10-05 (recorded in SCL-213 IS 6): on SIGNED-IN surfaces autocapture records no
 * element text (`mask_all_text: true`) — a clicked button or link there can carry a student's
 * name. Public pages keep PostHog's default. "Signed-in surface" is every page rendered through
 * `RequireRole`, which registers itself here while it is mounted; a counter, because a surface can
 * hand over to another (route change) before the first unmounts.
 */
let signedInSurfaces = 0;

function applyTextMasking(): void {
  instance?.set_config({ mask_all_text: signedInSurfaces > 0 });
}

/** Called by RequireRole on mount; the returned function is its unmount. */
export function enterSignedInSurface(): () => void {
  signedInSurfaces += 1;
  applyTextMasking();
  return () => {
    signedInSurfaces -= 1;
    applyTextMasking();
  };
}

export function analyticsConfigured(): boolean {
  return config() !== null;
}

export function startAnalytics(): Promise<void> {
  const cfg = config();
  if (cfg === null || instance !== null) return Promise.resolve();
  starting ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(cfg.key, {
      api_host: cfg.host,
      defaults: POSTHOG_DEFAULTS,
      person_profiles: "identified_only",
      mask_all_text: signedInSurfaces > 0,
      before_send: (event) =>
        event === null
          ? null
          : { ...event, properties: scrubProperties(event.properties) },
    });
    instance = posthog;
  });
  return starting;
}

const PH_STORAGE_KEY = /^(ph_|__ph)/;

function deletePostHogStorage(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(store)) {
      if (PH_STORAGE_KEY.test(key)) store.removeItem(key);
    }
  }
  const host = window.location.hostname;
  const labels = host.split(".");
  // PostHog sets its cookie on the widest domain it can (cross-subdomain by default).
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i += 1)
    domains.push(`; Domain=.${labels.slice(i).join(".")}`);
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim() ?? "";
    if (!PH_STORAGE_KEY.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
    }
  }
}

/** True when PostHog has been loaded in this page. */
export function analyticsRunning(): boolean {
  return instance !== null;
}

export function stopAnalytics(): void {
  if (instance === null) return;
  instance.stopSessionRecording();
  instance.opt_out_capturing();
  // Stop the SDK writing its persistence BEFORE deleting it: otherwise it re-saves on unload and
  // the cookie survives the withdrawal (caught by tests/e2e/analytics-consent.spec.ts).
  instance.set_config({ disable_persistence: true });
  deletePostHogStorage();
  window.location.reload();
}
