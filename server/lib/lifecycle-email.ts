/**
 * Onboarding events to Resend Automations: who onboarded, who became entitled.
 *
 * @spec [owner brief "Email lane — send onboarding events to Resend" + ruling (Karl, 2026-10-12):
 *       industry standard, no new infrastructure; contracts/notifications.contract.md §0 (the
 *       onboarding lane) and §14 (the reconcile leaves these contacts alone)] |
 * @implemented [2026-10-12; reminder 2026-10-21 (SCL-239); behaviour triggers 2026-10-21 (SCL-240)]
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
 * The send is handed to Vercel's `waitUntil` (Karl, 2026-10-13: Vercel's standard), which keeps
 * the function alive until it settles; outside Vercel it is a no-op and the promise simply runs.
 * A failure is logged with the profile id (digested by the logger), the step and Resend's status
 * code, and that is all; there is no retry and no queue (ruling). Logs never carry an address or
 * a name; nothing is stored in Lyceon's tables.
 *
 * Trade-offs: no outbox, so a crash or a Resend outage between the change and the call loses that
 * event (logged). Two concurrent first completions can both send `lyceon.onboarded` (accepted,
 * Karl 2026-10-13).
 *
 * BEHAVIOUR TRIGGERS (same brief, PR 2; SCL-240): `lyceon.diagnostic_unfinished`,
 * `lyceon.pro_no_plan` and `lyceon.practising_free` join the reminder on the same path. One rule
 * (`runLifecycleRule`) and one claim (`lifecycle_claim`) decide all four, so the cap (one
 * lifecycle email per student per 3 days; the QOTD email is not one) and the priority order
 * (reminder, diagnostic, Pro, practising) cover them together; each is re-checked at send time
 * and a trigger the student has since acted on is marked resolved and never sent.
 *
 * A THIRD FACT (owner brief "Lifecycle emails: reminder timing fix", Karl 2026-10-21; SCL-239):
 * `lyceon.reminder_due` `{}`, once per student, ever. Resend Automation delays are durations, so
 * the founding reminder fired exactly 72 h after signup — at night for a night signup. Lyceon
 * now decides WHEN: the lifecycle rule (`runLifecycleRule`) runs in the morning dispatch sweep (14:00 UTC,
 * 08:00–09:00 Chicago, inside the quiet-hours window and guarded by it), claims every student
 * whose onboarding is 3+ days old (since the cutover), not entitled, 13+, not deleted or
 * deletion-pending (`lifecycle_claim`, recorded once in the notification ledger), then
 * applies the denylist and sends the event. A refused send releases the claim, so the next
 * morning tries again. Resend holds the template and checks `entitled` once more.
 */
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { lifecycleEmailEnvSchema } from "../../packages/shared/src/env";
import { marketingOptInEligible } from "../../packages/shared/src/marketing-consent-schema";
import { quietHoursDeferral } from "./notifications/quiet-hours";
import {
  defaultContactsTransport,
  normaliseAddress,
  type ContactsTransport,
} from "./notifications/transport";
import { logger } from "../logger";

export const ONBOARDED_EVENT = "lyceon.onboarded";
export const ENTITLED_EVENT = "lyceon.entitled";
export const REMINDER_DUE_EVENT = "lyceon.reminder_due";

export type LifecycleRole = "student" | "guardian";

const lifecycleProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  display_name: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  deleted_at: z.string().nullable(),
});
export type LifecycleProfile = z.infer<typeof lifecycleProfileSchema>;

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
  const result = await eligibility(profileId, deps, event);
  return "skip" in result ? null : result;
}

/** Why not, or who: `deletion_state_unreadable` is the one transient reason. */
async function eligibility(
  profileId: string,
  deps: LifecycleDeps,
  event: string,
): Promise<Eligible | { skip: SkipReason | "deletion_state_unreadable" }> {
  const profile = await deps.loadProfile(profileId);
  const pending = profile ? await deps.hasPendingDeletion(profileId) : false;
  if (pending === null) {
    logger.warn("LIFECYCLE_EMAIL", "skipped", "Lifecycle event skipped", {
      profileId,
      event,
      reason: "deletion_state_unreadable",
    });
    return { skip: "deletion_state_unreadable" };
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
    return { skip: reason ?? "no_email" };
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

/**
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21) PR 1 and PR 2; contracts/notifications.contract.md C14A.4–C14A.5; SCL-239,
 *       SCL-240] | @implemented [2026-10-21]
 *
 * plain English: each ledger type, in the priority order `lifecycle_claim` applies, and the
 * Resend event that starts its Automation. Resend holds every template.
 */
export const LIFECYCLE_TRIGGER_EVENTS = {
  lifecycle_reminder_due: REMINDER_DUE_EVENT,
  lifecycle_diagnostic_unfinished: "lyceon.diagnostic_unfinished",
  lifecycle_pro_no_plan: "lyceon.pro_no_plan",
  lifecycle_practising_free: "lyceon.practising_free",
} as const;
export type LifecycleTrigger = keyof typeof LIFECYCLE_TRIGGER_EVENTS;
const lifecycleTriggerSchema = z.enum([
  "lifecycle_reminder_due",
  "lifecycle_diagnostic_unfinished",
  "lifecycle_pro_no_plan",
  "lifecycle_practising_free",
]);

export type LifecycleClaim = { profileId: string; trigger: LifecycleTrigger };

export type LifecycleClaimDeps = {
  /** lifecycle_claim: at most one email per student, decided at `now`; null when the call failed. */
  claimDue: (now: Date, limit: number) => Promise<LifecycleClaim[] | null>;
  /** lifecycle_release: put a refused send back to pending, so the next sweep tries again. */
  release: (claim: LifecycleClaim) => Promise<boolean>;
};

export type LifecycleRuleSummary = {
  ran: boolean;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
};

export const LIFECYCLE_CLAIM_BATCH = 500;
const LIFECYCLE_MAX_BATCHES = 20;

/**
 * @spec [same brief, PR 2 "Rules"; contracts/notifications.contract.md C14A.5, C6.6; SCL-240]
 *       | @implemented [2026-10-21]
 *
 * Every lifecycle email that is due this morning: `lifecycle_claim` records, resolves and picks
 * (once per trigger, ever; at most one per student per 3 days; the reminder first, then the
 * diagnostic, Pro and practising nudges), then each is told to Resend. Never during quiet hours:
 * outside the window it claims nothing and the next morning's sweep picks them up. A permanent
 * skip (under 13, deleted, denylisted, no address …) keeps the claim — that student never gets
 * this email; a refused send or an unreadable profile or deletion state releases it.
 */
export async function runLifecycleRule(
  now: Date,
  deps: LifecycleDeps & LifecycleClaimDeps,
): Promise<LifecycleRuleSummary> {
  const summary: LifecycleRuleSummary = {
    ran: false,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  if (quietHoursDeferral(now) !== null) {
    logger.info(
      "LIFECYCLE_EMAIL",
      "lifecycle_rule_quiet_hours",
      "Lifecycle rule skipped: quiet hours",
      {},
    );
    return summary;
  }
  summary.ran = true;
  for (let batch = 0; batch < LIFECYCLE_MAX_BATCHES; batch++) {
    const claimed = await deps.claimDue(now, LIFECYCLE_CLAIM_BATCH);
    if (claimed === null) {
      summary.failed += 1;
      break;
    }
    summary.claimed += claimed.length;
    for (const claim of claimed) {
      const event = LIFECYCLE_TRIGGER_EVENTS[claim.trigger];
      const target = await eligibility(claim.profileId, deps, event);
      if ("skip" in target) {
        // A read that failed (the claim proves the profile exists) is transient: retry tomorrow.
        if (
          target.skip === "deletion_state_unreadable" ||
          target.skip === "no_profile"
        ) {
          await deps.release(claim);
        }
        summary.skipped += 1;
        continue;
      }
      const sent = await deps.contacts.sendEvent(
        event,
        target.profile.email,
        {},
        { recipientProfileId: claim.profileId },
      );
      if (!sent.ok) {
        await deps.release(claim);
        summary.failed += 1;
        continue;
      }
      logger.info("LIFECYCLE_EMAIL", "sent", "Lifecycle event sent", {
        profileId: claim.profileId,
        event,
        role: target.role,
      });
      summary.sent += 1;
    }
    if (claimed.length < LIFECYCLE_CLAIM_BATCH) break;
  }
  logger.info(
    "LIFECYCLE_EMAIL",
    "lifecycle_rule",
    "Lifecycle rule ran",
    summary,
  );
  return summary;
}

const claimedRowsSchema = z.array(
  z.object({
    profile_id: z.string().uuid(),
    event_type: lifecycleTriggerSchema,
  }),
);

async function claimDueInDb(
  now: Date,
  limit: number,
): Promise<LifecycleClaim[] | null> {
  const { data, error } = await supabaseServer.rpc("lifecycle_claim", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) {
    logger.error(
      "LIFECYCLE_EMAIL",
      "lifecycle_claim_failed",
      "Lifecycle claim failed",
      { code: error.code },
    );
    return null;
  }
  const parsed = claimedRowsSchema.safeParse(data ?? []);
  if (!parsed.success) {
    logger.error(
      "LIFECYCLE_EMAIL",
      "lifecycle_claim_shape_invalid",
      "Lifecycle claim returned an unexpected shape",
      {},
    );
    return null;
  }
  return parsed.data.map((row) => ({
    profileId: row.profile_id,
    trigger: row.event_type,
  }));
}

async function releaseInDb(claim: LifecycleClaim): Promise<boolean> {
  const { data, error } = await supabaseServer.rpc("lifecycle_release", {
    p_profile_id: claim.profileId,
    p_event_type: claim.trigger,
  });
  if (error) {
    logger.error(
      "LIFECYCLE_EMAIL",
      "lifecycle_release_failed",
      "Lifecycle release failed; this email will not be retried",
      { profileId: claim.profileId, trigger: claim.trigger, code: error.code },
    );
    return false;
  }
  return data === true;
}

export function defaultLifecycleRuleDeps(): LifecycleDeps & LifecycleClaimDeps {
  return {
    ...defaultLifecycleDeps(),
    claimDue: claimDueInDb,
    release: releaseInDb,
  };
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
  if (data === null) return null;
  const parsed = lifecycleProfileSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(
      "LIFECYCLE_EMAIL",
      "profile_shape_invalid",
      "Profile row did not match the expected shape",
      { profileId },
    );
    return null;
  }
  return parsed.data;
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
 * error is logged (profile id and error class only) and dropped. The promise goes to `waitUntil`
 * so a Vercel function is not frozen before the send to Resend completes.
 */
export function fireLifecycle(
  label: string,
  profileId: string,
  task: () => Promise<unknown>,
): void {
  const settled = Promise.resolve()
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
  waitUntil(settled);
}
