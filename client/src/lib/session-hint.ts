/**
 * @spec [SEO plan F8; Coding Standards §6.1] | @implemented [2026-10-05]
 *
 * plain English: whether the last CSRF bootstrap (`GET /api/csrf-token`) said the request carried a
 * session cookie. `csrf.ts` writes it; the auth provider reads it at boot to skip the profile read
 * when there is no session to read, so a signed-out visitor never sees a 401 on a public page.
 *
 * expected outcome: `false` → no session cookie, boot proceeds signed out; `true` or `null`
 * (unknown: no bootstrap yet, a failed one, or a server that does not send the field) → the
 * profile is read exactly as before. It is a hint, never an authorization input: the server
 * decides who is signed in on every protected request.
 */
let sessionCookiePresent: boolean | null = null;

export function setSessionCookieHint(value: boolean | null): void {
  sessionCookiePresent = value;
}

export function getSessionCookieHint(): boolean | null {
  return sessionCookiePresent;
}
