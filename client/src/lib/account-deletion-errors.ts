import { SUPPORT_EMAIL } from "@/lib/support-contact";

/**
 * @spec [Doc-01_V8 §40 | Coding Standards §12.1 never leak raw server strings] | @implemented 2026-06-21
 * plain English: the deletion UI's error chokepoint. Account-deletion action failures are shown to the
 * user via CURATED copy keyed off the HTTP status only — never the raw server `error` string (same
 * discipline the auth surface and the /account/recover page already follow). Carry the status on a
 * typed error so the mutation's onError can map it without ever reading the response body.
 */
export class DeletionActionError extends Error {
  constructor(public readonly status: number) {
    super(`deletion action failed (${status})`);
    this.name = "DeletionActionError";
  }
}

export type DeletionErrorCopy = { title: string; description: string };

function sessionExpiredCopy(): DeletionErrorCopy {
  return {
    title: "Please sign in again",
    description: "Your session has expired. Sign in and try again.",
  };
}

export function deleteRequestErrorCopy(status: number): DeletionErrorCopy {
  switch (status) {
    case 401:
    case 403:
      return sessionExpiredCopy();
    case 429:
      return {
        title: "Too many attempts",
        description: "Please wait a moment and try again.",
      };
    default:
      return {
        title: "Could not schedule deletion",
        description: `Something went wrong. Please try again, or contact ${SUPPORT_EMAIL}.`,
      };
  }
}

export function cancelDeletionErrorCopy(status: number): DeletionErrorCopy {
  switch (status) {
    case 409:
      return {
        title: "We couldn't restore your account automatically",
        description: `Your email is no longer available. Contact ${SUPPORT_EMAIL} to recover your account.`,
      };
    case 401:
    case 403:
      return sessionExpiredCopy();
    default:
      return {
        title: "Could not cancel deletion",
        description: `Something went wrong. Please try again, or contact ${SUPPORT_EMAIL}.`,
      };
  }
}
