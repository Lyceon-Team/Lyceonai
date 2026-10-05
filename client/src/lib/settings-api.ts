/**
 * Settings writes that have no other client: the name save and the password change.
 *
 * @spec [student-UI register OQ-28 (narrow name-only save, F-54), UI-S4 (change password with the
 *        current password; `POST /api/auth/change-password`), UI-58; Coding Standards §7.1 (parse
 *        at every boundary), §11.1 (fetching lives outside components)] | @implemented [2026-10-03]
 *
 * plain English: two thin request functions. Each body is built through the shared `.strict()`
 * request schema before it is sent, so the name save can only ever carry `{ displayName }` (never
 * `marketingOptIn`, the F-54 hazard) and the password change always carries the current
 * password. A refusal is the server's own `{ error: { code, message } }`, read by
 * `parseApiErrorFromResponse`, so the page can show the server's sentence (for example
 * CURRENT_PASSWORD_INCORRECT). Nothing here logs; the passwords exist only in the request body.
 */
import {
  profileNameUpdateRequestSchema,
  profileNameUpdateResponseSchema,
  type ProfileNameUpdateResponse,
} from "@lyceon/shared/profile-name-schema";
import {
  changePasswordRequestSchema,
  PASSWORD_CHANGE_ERROR_CODES,
  type ChangePasswordRequest,
} from "@lyceon/shared/password-policy";
import { csrfFetch } from "@/lib/csrf";
import {
  isApiError,
  parseApiErrorFromResponse,
  toUserFacingMessage,
} from "@/lib/api-error";

export const PROFILE_NAME_PATH = "/api/profile/name" as const;
export const CHANGE_PASSWORD_PATH = "/api/auth/change-password" as const;

/**
 * The refusals whose message the server wrote for the person (a closed list, so an uncurated
 * server string can never be shown this way, AS-3): the name route's validation code and the password
 * routes' codes. Anything else gets the shared generic copy.
 */
const SERVER_WORDED_CODES: ReadonlySet<string> = new Set<string>([
  "INVALID_NAME",
  ...PASSWORD_CHANGE_ERROR_CODES,
]);

export function settingsErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code && SERVER_WORDED_CODES.has(error.code)) {
    return error.message;
  }
  return toUserFacingMessage(error).message;
}

export async function saveProfileName(
  displayName: string,
): Promise<ProfileNameUpdateResponse> {
  const body = profileNameUpdateRequestSchema.parse({ displayName });
  const res = await csrfFetch(PROFILE_NAME_PATH, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not save your name");
  }
  return profileNameUpdateResponseSchema.parse(await res.json());
}

export async function changePassword(
  input: ChangePasswordRequest,
): Promise<void> {
  const body = changePasswordRequestSchema.parse(input);
  const res = await csrfFetch(CHANGE_PASSWORD_PATH, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Failed to update password");
  }
}
