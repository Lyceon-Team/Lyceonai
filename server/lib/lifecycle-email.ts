/**
 * Onboarding events to Resend Automations: who onboarded, who became entitled.
 *
 * @spec [owner brief "Email lane — send onboarding events to Resend" + ruling (Karl, 2026-10-12):
 *       industry standard, no new infrastructure; contracts/notifications.contract.md §0 (the
 *       onboarding lane) and §14 (the reconcile leaves these contacts alone)] |
 * @implemented [2026-10-12]
 *
 * plain English: the founding-cohort emails (welcomes, a 3-day reminder) are a Resend Automation
 * that Karl edits in Resend. Lyceon tells Resend two facts and nothing else:
 *   - `lyceon.onboarded` `{ role }` on a profile's FIRST onboarding completion, after the contact
 *     is upserted with `first_name` (when the display name has a usable one) and `role`;
 *   - `lyceon.entitled` `{}` when an entitlement goes from not active to active, after setting the
 *     contact property `entitled = "true"`, for the student and, when a guardian paid, the payer.
 * Never for: an under-13 student (age from the date of birth; unknown is not 13+), an account
 * that is deleted or has a pending deletion request, or a denylisted address (env
 * LIFECYCLE_EMAIL_DENYLIST, plus any address whose local part contains "test").
 *
 * Fire-and-forget, after the response: `fireLifecycle` never throws and never delays the caller.
 * A failure is logged with the profile id (digested by the logger), the step and Resend's status
 * code, and that is all; there is no retry and no queue (ruling). Logs never carry an address or
 * a name; nothing is stored in Lyceon's tables.
 *
 * Trade-offs: no outbox, so a crash or a Resend outage between the change and the call loses that
 * event (logged). On Vercel, work after the response is best effort.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { lifecycleEmailEnvSchema } from "../../packages/shared/src/env";
import { marketingOptInEligible } from "../../packages/shared/src/marketing-consent-schema";
import {
  defaultContactsTransport,
  normaliseAddress,
  type ContactsTransport,
} from "./notifications/transport";
import { logger } from "../logger";

export const ONBOARDED_EVENT = "lyceon.onboarded";
export const ENTITLED_EVENT = "lyceon.entitled";

export type LifecycleRole = "student" | "guardian";

export type LifecycleProfile = {
  id: string;
  email: string | null;
  role: string | null;
  display_name: string | null;
  date_of_birth: string | null;
  deleted_at: string | null;
};

export type Denylist = {
  domains: ReadonlySet<string>;
  addresses: ReadonlySet<string>;
};

export type SkipReason =
  | "no_profile"
  | "no_email"
  | "not_student_or_guardian"
  | "under_13"
  | "deleted"
  | "deletion_pending"
  | "denylisted";

export type LifecycleDeps = {
  contacts: ContactsTransport;
  loadProfile: (profileId: string) => Promise<LifecycleProfile | null>;
  /** null when it could not be read: the send is skipped, never guessed. */
  hasPendingDeletion: (profileId: string) => Promise<boolean | null>;
  env: NodeJS.ProcessEnv;
  now: () => Date;
};

/**
 * The first word of the display name, as typed, when it is a usable first name: two or more
 * letters (an apostrophe or hyphen inside is fine), no digits, and not the address's own local
 * part (a username, not a name). Otherwise undefined, and `first_name` is left off the contact.
 */
export function lifecycleFirstName(
  displayName: string | null,
  email: string,
): string | undefined {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}(?:[\p{L}'’-]*\p{L})?$/u.test(first)) return undefined;
  if ([...first].filter((c) => /\p{L}/u.test(c)).length < 2) return undefined;
  const local = normaliseAddress(email).split("@")[0] ?? "";
  if (first.toLowerCase() === local) return undefined;
  return first;
}

/** `LIFECYCLE_EMAIL_DENYLIST`: comma-separated domains and full addresses. */
export function parseDenylist(raw: string | undefined): Denylist {
  const domains = new Set<string>();
  const addresses = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const value = entry.trim().toLowerCase().replace(/^@/, "");
    if (!value) continue;
    if (value.includes("@")) addresses.add(value);
    else domains.add(value);
  }
  return { domains, addresses };
}

/** Internal and test accounts: a listed address or domain, or "test" in the local part. */
export function isDenylisted(email: string, denylist: Denylist): boolean {
  const address = normaliseAddress(email);
  const at = address.lastIndexOf("@");
  const local = at >= 0 ? address.slice(0, at) : address;
  const domain = at >= 0 ? address.slice(at + 1) : "";
  if (local.includes("test")) return true;
  if (denylist.addresses.has(address)) return true;
  for (const d of denylist.domains) {
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }
  return false;
}

/** Pure: why this profile gets no onboarding contact or event, or null when it does. */
export function lifecycleSkipReason(
  profile: LifecycleProfile | null,
  facts: { pendingDeletion: boolean; denylist: Denylist; today: Date },
): SkipReason | null {
  if (!profile) return "no_profile";
  if (!profile.email) return "no_email";
  if (profile.role !== "student" && profile.role !== "guardian") {
    return "not_student_or_guardian";
  }
  if (
    profile.role === "student" &&
    !marketingOptInEligible(profile.date_of_birth, facts.today)
  ) {
    return "under_13";
  }
  if (profile.deleted_at !== null) return "deleted";
  if (facts.pendingDeletion) return "deletion_pending";
  if (isDenylisted(profile.email, facts.denylist)) return "denylisted";
  return null;
}

type Eligible = {
  profile: LifecycleProfile & { email: string };
  role: LifecycleRole;
};

async function eligibleProfile(
  profileId: string,
  deps: LifecycleDeps,
  event: string,
): Promise<Eligible | null> {
  const profile = await deps.loadProfile(profileId);
  const pending = profile ? await deps.hasPendingDeletion(profileId) : false;
  if (pending === null) {
    logger.warn("LIFECYCLE_EMAIL", "skipped", "Lifecycle event skipped", {
      profileId,
      event,
      reason: "deletion_state_unreadable",
    });
    return null;
  }
  const parsed = lifecycleEmailEnvSchema.safeParse(deps.env);
  const reason = lifecycleSkipReason(profile, {
    pendingDeletion: pending,
    denylist: parseDenylist(
      parsed.success ? parsed.data.LIFECYCLE_EMAIL_DENYLIST : undefined,
    ),
    today: deps.now(),
  });
  if (reason !== null || !profile || !profile.email) {
    logger.info("LIFECYCLE_EMAIL", "skipped", "Lifecycle event skipped", {
      profileId,
      event,
      reason,
    });
    return null;
  }
  return {
    profile: { ...profile, email: profile.email },
    role: profile.role === "guardian" ? "guardian" : "student",
  };
}

export type LifecycleOutcome = "sent" | "skipped" | "failed";

/** `lyceon.onboarded`: upsert the contact (first name, role), then send the event. */
export async function sendOnboardedEvent(
  profileId: string,
  deps: LifecycleDeps,
): Promise<LifecycleOutcome> {
  const target = await eligibleProfile(profileId, deps, ONBOARDED_EVENT);
  if (!target) return "skipped";
  const context = { recipientProfileId: profileId };
  const firstName = lifecycleFirstName(
    target.profile.display_name,
    target.profile.email,
  );
  const contact = await deps.contacts.upsertContact(
    target.profile.email,
    {
      ...(firstName !== undefined ? { firstName } : {}),
      properties: { role: target.role },
    },
    context,
  );
  if (!contact.ok) return "failed";
  const sent = await deps.contacts.sendEvent(
    ONBOARDED_EVENT,
    target.profile.email,
    { role: target.role },
    context,
  );
  if (!sent.ok) return "failed";
  logger.info("LIFECYCLE_EMAIL", "sent", "Lifecycle event sent", {
    profileId,
    event: ONBOARDED_EVENT,
    role: target.role,
  });
  return "sent";
}

/**
 * `lyceon.entitled`: for the student and, when someone else paid, the payer. Each gets the
 * contact property `entitled = "true"` first, so the automation can also read it as a condition.
 */
export async function sendEntitledEvents(
  grant: { studentProfileId: string; payerProfileId: string | null },
  deps: LifecycleDeps,
): Promise<LifecycleOutcome[]> {
  const recipients = [grant.studentProfileId];
  if (grant.payerProfileId && grant.payerProfileId !== grant.studentProfileId) {
    recipients.push(grant.payerProfileId);
  }
  const outcomes: LifecycleOutcome[] = [];
  for (const profileId of recipients) {
    const target = await eligibleProfile(profileId, deps, ENTITLED_EVENT);
    if (!target) {
      outcomes.push("skipped");
      continue;
    }
    const context = { recipientProfileId: profileId };
    const contact = await deps.contacts.upsertContact(
      target.profile.email,
      { properties: { role: target.role, entitled: "true" } },
      context,
    );
    if (!contact.ok) {
      outcomes.push("failed");
      continue;
    }
    const sent = await deps.contacts.sendEvent(
      ENTITLED_EVENT,
      target.profile.email,
      {},
      context,
    );
    if (!sent.ok) {
      outcomes.push("failed");
      continue;
    }
    logger.info("LIFECYCLE_EMAIL", "sent", "Lifecycle event sent", {
      profileId,
      event: ENTITLED_EVENT,
      role: target.role,
    });
    outcomes.push("sent");
  }
  return outcomes;
}

async function loadProfileFromDb(
  profileId: string,
): Promise<LifecycleProfile | null> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("id, email, role, display_name, date_of_birth, deleted_at")
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    logger.warn(
      "LIFECYCLE_EMAIL",
      "profile_read_failed",
      "Profile read failed",
      {
        profileId,
        code: error.code,
      },
    );
    return null;
  }
  return (data as LifecycleProfile | null) ?? null;
}

async function hasPendingDeletionInDb(
  profileId: string,
): Promise<boolean | null> {
  const { data, error } = await supabaseServer
    .from("account_deletion_requests")
    .select("id")
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

export function defaultLifecycleDeps(): LifecycleDeps {
  return {
    contacts: defaultContactsTransport(),
    loadProfile: loadProfileFromDb,
    hasPendingDeletion: hasPendingDeletionInDb,
    env: process.env,
    now: () => new Date(),
  };
}

/**
 * Run a lifecycle send without awaiting it. Never throws, never delays the caller: an unexpected
 * error is logged (profile id and error class only) and dropped.
 */
export function fireLifecycle(
  label: string,
  profileId: string,
  task: () => Promise<unknown>,
): void {
  void Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      logger.error(
        "LIFECYCLE_EMAIL",
        "unexpected_failure",
        "Lifecycle send threw",
        {
          profileId,
          label,
          error: error instanceof Error ? error.name : "unknown",
        },
      );
    });
}
