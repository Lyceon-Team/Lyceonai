/**
 * What the boot sequence checks, and how it decides — as pure functions.
 *
 * @spec [Doc-06B §3 "Secrets at Runtime"; Coding Standards §2 layering,
 *        §3.5 discriminated unions, §12.1 redacted logging]
 * @implemented [2026-09-11]
 *
 * plain English: decides whether a missing environment variable should stop
 * the process or merely be reported, and returns that decision rather than
 * acting on it. Expected outcome: `server/index.ts` keeps the `process.exit`
 * at the composition root while the reasoning behind it is testable.
 *
 * `NODE_ENV` IS THE WRONG QUESTION, AND IT COST EVERY PREVIEW.
 * `NODE_ENV=production` describes the BUILD MODE. Vercel sets it for preview,
 * staging and production alike. `VERCEL_ENV` names the DEPLOYMENT TARGET.
 * Two startup guards read the first and acted as if they had read the second,
 * so every preview deployment of this repo died at boot and returned
 * 500 `FUNCTION_INVOCATION_FAILED` on every route (observed on PR #717).
 *
 * THE TWO DEFECTS SHARED A GATE AND NEED DIFFERENT ANSWERS. Collapsing them
 * is the mistake this comment exists to prevent:
 *
 *  - `GCP_SERVICE_ACCOUNT_JSON` is SUBSYSTEM-SCOPED. It serves the LISA crisis
 *    classifier and the BigQuery retention archive. Billing, auth, entitlement
 *    and the guardian surfaces never touch it. A missing tutor credential
 *    taking down checkout is a dependency nothing declared — so it does not
 *    gate boot at all. It fails at USE, and is reported once at startup.
 *  - `PUBLIC_SITE_URL` is WHOLE-APP: OAuth cannot build a callback without it.
 *    The requirement is real, so it is not removed — it is scoped to the
 *    deployment target that actually has to meet it.
 */
import { getGcpCredentials } from "./gcp-credentials";
import { logger } from "../logger";

/**
 * Is this the PRODUCTION DEPLOYMENT — not merely a production BUILD?
 *
 * `VERCEL_ENV === "production"` is the authoritative answer on Vercel, where
 * this app is deployed; `"preview"` and `"development"` are the other values.
 *
 * WHY THE SECOND CLAUSE. Keying on `VERCEL_ENV` alone would silently stop
 * enforcing on any host that does not set it — a self-hosted run, a container,
 * a `NODE_ENV=production` boot anywhere off Vercel — which deletes the
 * requirement rather than scoping it. So when `VERCEL_ENV` is absent entirely
 * we fall back to the build mode: absent means "not a Vercel deployment", not
 * "not production". Only a Vercel deployment that explicitly says it is NOT
 * production is exempted.
 */
export function isProductionDeployment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "production";
  return env.NODE_ENV === "production";
}

/**
 * The verdict on `PUBLIC_SITE_URL`. `fatal` is the only kind that stops the
 * process; the caller owns the `process.exit`, so this stays testable.
 */
export type SiteUrlVerdict =
  | {
      readonly kind: "fatal";
      readonly reason: "missing" | "not_https";
      readonly lines: readonly string[];
    }
  | { readonly kind: "proceed"; readonly lines: readonly string[] };

/**
 * Evaluate `PUBLIC_SITE_URL` for the current deployment target.
 *
 * Every message the previous inline version emitted is preserved verbatim —
 * this changes WHEN the process dies, never WHAT an operator reads.
 */
export function evaluateSiteUrl(input: {
  readonly publicSiteUrl: string | undefined;
  readonly isProductionDeployment: boolean;
}): SiteUrlVerdict {
  const { publicSiteUrl, isProductionDeployment: isProd } = input;

  if (!publicSiteUrl) {
    if (isProd) {
      return {
        kind: "fatal",
        reason: "missing",
        lines: [
          "❌ [FATAL] PUBLIC_SITE_URL is not set. OAuth will fail in production.",
          "   Set PUBLIC_SITE_URL=https://lyceon.ai in your environment.",
        ],
      };
    }
    return {
      kind: "proceed",
      lines: [
        "⚠️ [WARN] PUBLIC_SITE_URL is not set. OAuth may fail.",
        "   For development, set PUBLIC_SITE_URL or use REPLIT_DEV_DOMAIN fallback.",
      ],
    };
  }

  if (!publicSiteUrl.startsWith("https://") && isProd) {
    return {
      kind: "fatal",
      reason: "not_https",
      lines: ["❌ [FATAL] PUBLIC_SITE_URL must use HTTPS in production."],
    };
  }

  const lines: string[] = [];
  if (publicSiteUrl.endsWith("/")) {
    lines.push(
      "⚠️ [WARN] PUBLIC_SITE_URL has trailing slash, this may cause redirect issues.",
    );
  }
  const normalizedUrl = publicSiteUrl.replace(/\/$/, "").toLowerCase();
  if (isProd && !normalizedUrl.includes("lyceon.ai")) {
    lines.push(
      "⚠️ [WARN] PUBLIC_SITE_URL does not contain lyceon.ai - verify this is intentional.",
    );
  }
  lines.push(`✅ [AUTH] PUBLIC_SITE_URL: ${publicSiteUrl}`);
  lines.push(
    `✅ [AUTH] Native OAuth landing: ${publicSiteUrl.replace(/\/$/, "")}/auth/callback`,
  );

  return { kind: "proceed", lines };
}

/** Once per process. A boot banner that repeats is a boot banner ignored. */
let gcpStatusReported = false;

/** Test-only reset. Nothing in the boot path calls this. */
export function __resetGcpStartupReportForTests(): void {
  gcpStatusReported = false;
}

/**
 * Report whether GCP credentials are available. NEVER throws, NEVER exits.
 *
 * This replaces a `process.exit(1)` that treated a subsystem credential as a
 * whole-app requirement. The absence is a fact about LISA's crisis classifier
 * and the retention archive — it is logged once, at WARN, naming the variable
 * and what will not work, and the process starts.
 *
 * The credential itself never reaches the log: `getGcpCredentials` throws
 * fixed-vocabulary errors precisely so that its message is safe to print.
 */
export function reportGcpCredentialStatusAtStartup(): void {
  if (gcpStatusReported) return;
  gcpStatusReported = true;

  try {
    const creds = getGcpCredentials();
    logger.info("GCP", "credentials_loaded", "GCP service account loaded", {
      projectId: creds.project_id,
    });
  } catch (err: unknown) {
    logger.warn(
      "GCP",
      "credentials_absent",
      "GCP_SERVICE_ACCOUNT_JSON is unavailable. The LISA crisis classifier " +
        "(Layer 2) and the BigQuery retention archive will fail when called. " +
        "Every other surface — billing, auth, entitlement, guardian, practice " +
        "— is unaffected and starts normally.",
      { reason: err instanceof Error ? err.message : "credential load failed" },
    );
  }
}
