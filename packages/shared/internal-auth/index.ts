/**
 * @spec [Doc-01A_V1 Part VII §61–§71; Doc-03C_V3 §9.3]
 *
 * Internal service auth — canonical utilities for signing, verifying, and
 * loading secrets for service-to-service calls.
 *
 * Two auth mechanisms coexist per the spec:
 *  - HMAC-SHA256 (01A Part VII): for service pairs where the caller controls
 *    timing (BFF→worker, scheduler→enqueue, etc.)
 *  - OIDC (03C §9.3): for Cloud Tasks delivery, where the token is minted at
 *    delivery time (not enqueue time) and retries get fresh credentials.
 *
 * This module lives at `packages/shared/internal-auth/` per §70 reference
 * implementation. It is NOT re-exported from `packages/shared/src/index.ts`
 * because it has server-side-only dependencies (supabase-server, logger,
 * node:crypto, google-auth-library) that frontend code must never import.
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
export {
  oidcAuthMiddleware,
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
  type OidcMiddlewareOptions,
} from "./verify-oidc-middleware";
