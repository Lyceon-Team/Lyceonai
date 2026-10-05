/**
 * Cloudflare Turnstile widget for the Question of the Day submit.
 *
 * @spec [SCL-202 item 2 (Turnstile token on public submits, verified server-side); owner Step 0
 *       decision 8, 2026-10-05 (Cloudflare's published test keys until the real ones exist)]
 *       | @implemented [2026-10-05]
 *
 * plain English: loads Cloudflare's script once, on demand (never during the build-time render,
 * since effects do not run there), renders the widget explicitly into this component and hands
 * each fresh token to `onToken`. A token is single-use, so the parent calls `reset` (via `key`)
 * after a submit. An expired or failed challenge clears the token.
 *
 * The site key is public by design. Until VITE_TURNSTILE_SITE_KEY is set, Cloudflare's
 * published always-pass test site key is used; it only produces tokens the test secret accepts.
 * The page CSP allows https://challenges.cloudflare.com in script-src and frame-src for this.
 */
import { useEffect, useRef } from "react";

/** Cloudflare's published test site key that always passes (Turnstile testing docs). */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  action?: string;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile_unavailable"));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile_script_failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function turnstileSiteKey(): string {
  const configured = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : TURNSTILE_TEST_SITE_KEY;
}

export function TurnstileWidget({
  onToken,
  onUnavailable,
}: {
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-rendering the widget when the parent re-renders.
  const handlers = useRef({ onToken, onUnavailable });
  handlers.current = { onToken, onUnavailable };

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: turnstileSiteKey(),
          action: "qotd_submit",
          callback: (token) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => handlers.current.onToken(null),
        });
      })
      .catch(() => {
        // Surfaced, not swallowed: the parent shows "the check could not load" and keeps
        // submit disabled, since the server would refuse a submit without a token anyway.
        if (!cancelled) handlers.current.onUnavailable();
      });
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, []);

  return <div ref={container} data-testid="qotd-turnstile" />;
}
