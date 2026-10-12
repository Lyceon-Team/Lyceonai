/**
 * The Desmos stand-in for browser specs that run where no Desmos key is held (CI).
 *
 * @spec [n/a — e2e test-harness tooling; the calculator itself is Doc-02B_v4 §28]
 * @implemented [2026-10-07]
 *
 * plain English: moved unchanged out of page-csp-flows.spec.ts (INV-10A-17, 2026-10-06) so the
 * exam harness specs (exam-shell, exam-desmos) can use the SAME stand-in under the nightly
 * `exam-calendar-e2e` job instead of a second copy. With E2E_DESMOS_STUB=1 a spec answers the
 * real www.desmos.com calculator.js URL (the one DesmosCalculator.tsx requests when the build
 * carries a VITE_DESMOS_API_KEY) with a minimal script that defines the calculator API the app
 * calls and draws the two elements the specs drive (`.dcg-container`, an editable field),
 * firing "change" on input. Expected outcome: the app's calculator wiring (script request,
 * mount, panel, error state absent) is exercised with no network. Trade-off: it proves nothing
 * about the real Desmos runtime — that is G-EX-08, which needs a real key and desmos.com
 * (E2E_DESMOS_REACHABLE=1), and a stubbed run never claims it.
 */
import type { BrowserContext, Page, Route } from "@playwright/test";

/** The pinned calculator script URL (DesmosCalculator.tsx), and the patch release it 302s to. */
export const DESMOS_SCRIPT =
  /^https:\/\/www\.desmos\.com\/api\/v1\.11[^/]*\/calculator\.js/;

/**
 * E2E_DESMOS_STUB=1: the calculator API the app calls (DesmosCalculator.tsx), drawing the two
 * elements the flow drives (`.dcg-container`, an editable field) and firing "change" on input.
 */
export const DESMOS_STUB_JS = `(function () {
  function make(el) {
    var box = document.createElement("div");
    box.className = "dcg-container";
    var field = document.createElement("div");
    field.className = "dcg-mq-editable-field";
    field.setAttribute("contenteditable", "true");
    box.appendChild(field);
    el.appendChild(box);
    var handlers = [];
    var state = { expressions: { list: [] } };
    field.addEventListener("input", function () {
      state = { expressions: { list: [{ latex: field.textContent }] } };
      handlers.forEach(function (h) { h(); });
    });
    return {
      getState: function () { return state; },
      setState: function (s) { state = s; },
      observeEvent: function (_n, h) { handlers.push(h); },
      unobserveEvent: function () { handlers = []; },
      resize: function () {},
      destroy: function () { box.remove(); }
    };
  }
  window.Desmos = { GraphingCalculator: make, ScientificCalculator: make };
})();`;

/** True when the run answers Desmos with the stand-in (E2E_DESMOS_STUB=1). */
export const DESMOS_STUBBED = process.env.E2E_DESMOS_STUB === "1";

/** Answers the real calculator.js URL with the stand-in, for this page (or every page of a context). */
export async function stubDesmos(target: Page | BrowserContext): Promise<void> {
  await target.route(DESMOS_SCRIPT, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: DESMOS_STUB_JS,
    }),
  );
}

/**
 * @spec [n/a — e2e test-harness tooling; owner brief 2026-10-11 (the exam-shell calculator test
 *       must pass where Desmos loads)] | @implemented [2026-10-11]
 * plain English: E2E_DESMOS_SCRIPT_FILE=<path to a saved copy of www.desmos.com's calculator.js>
 * answers the calculator.js URL with that REAL Desmos runtime, for browsers that cannot reach
 * desmos.com themselves (an intercepting proxy whose CA the browser does not trust). Unlike the
 * stand-in above, this IS the real Desmos runtime, so a run with it counts as "Desmos loads"
 * (set E2E_DESMOS_REACHABLE=1 alongside it). No TLS check is weakened: the copy was fetched
 * over verified TLS by the tool that saved it.
 */
export const DESMOS_SCRIPT_FILE = process.env.E2E_DESMOS_SCRIPT_FILE ?? "";

export async function serveRealDesmosFromFile(
  target: Page | BrowserContext,
): Promise<void> {
  if (!DESMOS_SCRIPT_FILE) return;
  await target.route(DESMOS_SCRIPT, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      path: DESMOS_SCRIPT_FILE,
    }),
  );
}
