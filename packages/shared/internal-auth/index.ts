/**
 * @spec [Doc-03C_V3 §9.3; owner ruling 2026-10-05 C-03 (HMAC service auth retired)]
 *
 * Internal service auth — OIDC verification for service-to-service calls.
 *
 * Every internal route authenticates by OIDC (03C §9.3): the token is minted at delivery time,
 * so retries get fresh credentials. The HMAC-SHA256 path (Doc 01A Part VII) and its
 * `service_auth_secrets` table were retired on 2026-10-05 (C-03): no route used them.
 *
 * This module lives at `packages/shared/internal-auth/`. It is NOT re-exported from
 * `packages/shared/src/index.ts` because it has server-side-only dependencies (logger,
 * google-auth-library) that frontend code must never import.
 *
 * Import directly from `./verify-oidc-middleware` (as every route does) or from here.
 */
export {
  oidcAuthMiddleware,
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
  type OidcMiddlewareOptions,
} from "./verify-oidc-middleware";
