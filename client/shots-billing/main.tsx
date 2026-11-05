/**
 * Screenshot harness for the cancellation control — NOT shipped.
 *
 * @spec [SCL-271; SCL-272; docs/plans/student-ui/design/DESIGN.md §5 UI standards
 *        ("Check each new screen against §5 in the PR description ... and attach
 *         screenshots")] | @implemented [2026-11-03]
 *
 * plain English: mounts the REAL `CancelSubscriptionDialog` with a row handed to it in the URL,
 * so a screenshot shows the shipped component rather than a mock. Expected outcome: the §5
 * checklist in the PR can be read against pictures of the actual control.
 *
 * THE ROW IS PRODUCED IN NODE AND PASSED IN, NOT BUILT HERE. `scripts/shots-billing.mts` calls
 * the server's own `describeCancellable` — the function `GET /cancel-state` maps over its
 * subscriptions — and hands the result over as `?row=`, which this page parses with the shared
 * schema before rendering. Importing that function INTO the page was tried and rejected: it
 * pulls `server/lib/redact.ts` and therefore `node:crypto` into a browser bundle, and stubbing
 * around that would have meant a row built by hand after all.
 *
 * IT DOES IMPORT THE GLOBAL TOKEN STYLESHEETS, unlike the calendar harness beside it
 * (`client/shots/`), which omits them on purpose to catch missing `var()` fallbacks. The claim
 * being evidenced here is the opposite one — "tokens only, no raw hex", one filled primary
 * action, nothing below 14px — and none of that is visible in a page with no tokens at all.
 */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cancellableSubscriptionSchema } from "@lyceon/shared/billing-schema";
import { CancelSubscriptionDialog } from "@/components/billing/CancelSubscriptionDialog";
import "@/index.css";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

const params = new URLSearchParams(window.location.search);
const encoded = params.get("row");
if (encoded === null) throw new Error("no ?row= was supplied");
const subscription = cancellableSubscriptionSchema.parse(
  JSON.parse(atob(encoded)),
);
const forLabel = params.get("for");
/**
 * `lyc` reproduces the student shell's root (`layout/RouteSkeleton.tsx:112`), where the student
 * tokens resolve. Omit it with `?surface=default` to see the guardian page's look, which has no
 * such root. The dialog itself portals to <body> either way — outside the root, exactly as it
 * does in the app — so the screenshots show the real relationship between the two.
 */
const surface = params.get("surface") === "default" ? "default" : "lyc";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const mount = document.getElementById("root");
if (mount === null) throw new Error("no #root");

createRoot(mount).render(
  <QueryClientProvider client={client}>
    {/*
      The wrapper's own chrome is INLINE STYLE, not Tailwind utilities, and has to be:
      `tailwind.config.ts:7` scans `client/src` only, so a utility class written in this
      directory is never generated and would silently render as nothing. The component under
      the lens lives in `client/src`, so ITS classes are real — which is the only part that
      has to be.
    */}
    <div
      className={surface === "lyc" ? "lyc" : undefined}
      style={{
        minHeight: "100vh",
        padding: 40,
        ...(surface === "lyc"
          ? {}
          : { background: "var(--cream-50)", color: "var(--primary)" }),
      }}
    >
      <div
        style={{
          margin: "0 auto",
          display: "flex",
          maxWidth: 640,
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 16,
          borderRadius: 16,
          padding: 32,
          background: surface === "lyc" ? "var(--sheet)" : "#ffffff",
          border: `1px solid ${surface === "lyc" ? "var(--rule)" : "var(--cream-200, #e7e0cf)"}`,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          Lyceon plan
        </h2>
        <p style={{ margin: 0, fontSize: 17 }}>
          {subscription.decision === "already_scheduled" ||
          subscription.decision === "already_canceled"
            ? "Ending soon"
            : subscription.stripeStatus === "past_due"
              ? "Payment needs updating"
              : "Active"}
        </p>
        <CancelSubscriptionDialog
          subscription={subscription}
          surface={surface}
          {...(forLabel === null ? {} : { forLabel })}
        />
      </div>
    </div>
  </QueryClientProvider>,
);
