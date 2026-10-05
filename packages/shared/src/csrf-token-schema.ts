/**
 * `GET /api/csrf-token` response.
 *
 * @spec [lyceon-coding-standards §7.1, §7.2; SEO plan F8] | @implemented [2026-10-05]
 *
 * plain English: the CSRF bootstrap answer. `csrfToken` is the double-submit token;
 * `sessionCookiePresent` says whether the request carried a session cookie, so a page with no
 * session can skip the profile read (which would only answer 401). It is a hint, not
 * authentication: the server decides who is signed in on every protected request.
 */
import { z } from "zod";

export const csrfTokenResponseSchema = z.object({
  csrfToken: z.string().min(1),
  sessionCookiePresent: z.boolean(),
});
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>;
