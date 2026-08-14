/**
 * @spec [Doc-01A_V1 Part VII §61–§71]
 *
 * Internal service auth (HMAC-SHA256) — canonical utilities for signing,
 * verifying, and loading secrets for service-to-service calls.
 *
 * This module lives at `packages/shared/internal-auth/` per §70 reference
 * implementation. It is NOT re-exported from `packages/shared/src/index.ts`
 * because it has server-side-only dependencies (supabase-server, logger,
 * node:crypto) that frontend code must never import.
 *
 * Import directly: `import { signInternalRequest } from "@lyceon/shared/internal-auth"`
 * or from the individual files.
 */
export { loadActiveSecret, loadServiceSecrets } from "./load-secrets";
export {
  signInternalRequest,
  signWithExplicitSecret,
  type SignedHeaders,
  type SignResult,
} from "./sign-request";
export {
  internalAuthMiddleware,
  type InternalAuthMiddlewareOptions,
} from "./verify-middleware";
