/**
 * The marketing email lane's daily reconcile: Lyceon → Resend.
 *
 * @spec [contracts/notifications.contract.md §0 (marketing lane) and §14 (amended 2026-10-07);
 *       docs/plans/seo/seo-marketing-vertical.md row D3, R26; Privacy Policy v6 §9.2; owner
 *       brief "SEO vertical — email lane" + Step 0 decisions 2026-10-07 (Karl): 1 daily reconcile
 *       only, 2 delete the contact on opt-out, 3 marketing stops at the deletion request, 6 the
 *       two synced segments are the only marketing audience] | @implemented [2026-10-07]
 *
 * plain English: once a day, make the Resend account hold exactly one contact per person
 * `marketing_email_audience()` returns (opted in, 13+, not deleted, no pending deletion,
 * student or guardian), each in its audience's segment, and nothing else.
 *
 *   1. READ everything first: the audience, the contacts Lyceon recorded, the account's
 *      segments, every contact in the account, and the members of the two synced segments. If
 *      ANY read fails, or a configured segment does not exist, the run stops before writing
 *      anything. A partial picture must never become a mass deletion.
 *   2. PLAN with a pure function (`planMarketingReconcile`), so every rule is tested without
 *      a network or a database.
 *   3. APPLY in a fixed order: unsubscribes come back FIRST, then deletions, then creations.
 *      An unsubscribed contact is reported to `apply_marketing_email_optout` (source
 *      `email_unsubscribe`, ledger id `reconcile:<contact id>`) BEFORE it is deleted, so the
 *      choice it carries is never lost with it. That is also how the 72 manually imported
 *      launch contacts are retired: the first run brings their unsubscribes back, then deletes
 *      every one of them that is not backed by an eligible, opted-in profile.
 *
 * State-based, so it is idempotent and retry-safe: a second run over the same state plans
 * nothing. Writes are spaced (`RESEND_CALL_SPACING_MS`) to stay well under Resend's 10 req/s
 * team limit, which product email shares, and capped per run (`MAX_WRITES_PER_RUN`); what is left
 * over is done tomorrow.
 *
 * Privacy: addresses are held in memory for one run, compared and passed to Resend. Logs carry
 * counts, contact ids, profile ids (digested by the logger) and segment ids. Never an address,
 * never a provider payload, never the key.
 *
 * trade-offs: a contact in the wrong synced segment (a role change) is deleted and created
 * again rather than moved, so the client needs no membership-edit calls. A contact matching an
 * eligible profile that sits in no synced segment (for example a manual import) is treated the
 * same way: it is replaced by one Lyceon created.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { marketingEmailEnvSchema } from "../../packages/shared/src/env";
import type { RpcClient } from "./rpc-client";
import {
  defaultContactsTransport,
  normaliseAddress,
  type ContactsTransport,
  type ResendContact,
  type ResendSegment,
} from "./notifications/transport";
import { logger } from "../logger";

export type MarketingSegment = "students" | "guardians";

export const MAX_WRITES_PER_RUN = 500;
export const RESEND_CALL_SPACING_MS = 150;
/**
 * Writes stop being started after this long, so a run ends well inside a conservative serverless
 * timeout (no `maxDuration` is configured for the API function). What is left is counted as
 * `deferred` and done the next day; the plan is state-based, so nothing is half-applied.
 */
export const RUN_WRITE_DEADLINE_MS = 45_000;

const audienceRowSchema = z
  .object({
    profile_id: z.string().uuid(),
    email: z.string().min(1),
    segment: z.enum(["students", "guardians"]),
  })
  .strict();
export type AudienceRow = z.infer<typeof audienceRowSchema>;

const knownRowSchema = z
  .object({
    profile_id: z.string().uuid(),
    resend_contact_id: z.string().min(1),
    segment: z.enum(["students", "guardians"]),
  })
  .strict();
export type KnownContactRow = z.infer<typeof knownRowSchema>;

const optOutOutcomeSchema = z.enum([
  "applied",
  "unchanged",
  "unmatched",
  "duplicate",
]);

export type SegmentIds = Record<MarketingSegment, string>;

export type ReconcileInput = {
  audience: readonly AudienceRow[];
  known: readonly KnownContactRow[];
  /** Every contact in the account. */
  contacts: readonly ResendContact[];
  /** Contact ids in each synced segment. */
  members: Record<MarketingSegment, ReadonlySet<string>>;
};

export type ReconcilePlan = {
  /** Unsubscribed in Resend: bring the choice back to Lyceon before the contact is deleted. */
  optOut: { contactId: string; email: string }[];
  delete: { contactId: string; profileId: string | null }[];
  create: { profileId: string; email: string; segment: MarketingSegment }[];
  /** Already correct in Resend; make sure Lyceon's record says so. */
  record: { profileId: string; contactId: string; segment: MarketingSegment }[];
  /** Lyceon records a contact that no longer exists or is being deleted. */
  forget: string[];
};

/**
 * The whole rule set, pure. Every remote contact is either KEPT (backed by an eligible profile,
 * subscribed, in exactly that profile's segment) or DELETED; every eligible profile without a
 * kept contact gets one CREATED — unless its contact was unsubscribed, in which case the opt-out
 * is applied and nothing is created.
 */
export function planMarketingReconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = {
    optOut: [],
    delete: [],
    create: [],
    record: [],
    forget: [],
  };
  const eligible = new Map<string, AudienceRow>();
  for (const row of input.audience)
    eligible.set(normaliseAddress(row.email), row);
  const knownByContact = new Map(
    input.known.map((k) => [k.resend_contact_id, k]),
  );
  const knownByProfile = new Map(input.known.map((k) => [k.profile_id, k]));
  const settled = new Set<string>(); // profile ids that need no create
  const kept = new Set<string>(); // contact ids that survive

  for (const contact of input.contacts) {
    const owner = eligible.get(normaliseAddress(contact.email)) ?? null;
    const knownOwner = knownByContact.get(contact.id)?.profile_id ?? null;
    if (contact.unsubscribed) {
      plan.optOut.push({ contactId: contact.id, email: contact.email });
      plan.delete.push({
        contactId: contact.id,
        profileId: owner?.profile_id ?? knownOwner,
      });
      if (owner) settled.add(owner.profile_id);
      continue;
    }
    if (!owner) {
      plan.delete.push({ contactId: contact.id, profileId: knownOwner });
      continue;
    }
    const other: MarketingSegment =
      owner.segment === "students" ? "guardians" : "students";
    const placed =
      input.members[owner.segment].has(contact.id) &&
      !input.members[other].has(contact.id);
    if (!placed || settled.has(owner.profile_id)) {
      plan.delete.push({ contactId: contact.id, profileId: owner.profile_id });
      continue;
    }
    kept.add(contact.id);
    settled.add(owner.profile_id);
    const record = knownByProfile.get(owner.profile_id);
    if (
      !record ||
      record.resend_contact_id !== contact.id ||
      record.segment !== owner.segment
    ) {
      plan.record.push({
        profileId: owner.profile_id,
        contactId: contact.id,
        segment: owner.segment,
      });
    }
  }

  for (const row of input.audience) {
    if (!settled.has(row.profile_id)) {
      plan.create.push({
        profileId: row.profile_id,
        email: row.email,
        segment: row.segment,
      });
    }
  }
  for (const k of input.known) {
    if (!kept.has(k.resend_contact_id)) plan.forget.push(k.resend_contact_id);
  }
  return plan;
}

export type ReconcileSummary = {
  ok: boolean;
  /** Why the run stopped before writing, when it did. */
  aborted: "config_missing" | "segment_missing" | "read_failed" | null;
  eligible: number;
  optedOut: number;
  deleted: number;
  created: number;
  recorded: number;
  forgotten: number;
  failed: number;
  deferred: number;
  foreignSegments: number;
  purgedEvents: number;
};

export type ReconcileOptions = {
  db?: RpcClient;
  contacts?: ContactsTransport;
  env?: NodeJS.ProcessEnv;
  pause?: (ms: number) => Promise<void>;
  /** Milliseconds since some fixed point; injectable so the deadline is testable. */
  now?: () => number;
  requestId?: string;
};

function emptySummary(): ReconcileSummary {
  return {
    ok: false,
    aborted: null,
    eligible: 0,
    optedOut: 0,
    deleted: 0,
    created: 0,
    recorded: 0,
    forgotten: 0,
    failed: 0,
    deferred: 0,
    foreignSegments: 0,
    purgedEvents: 0,
  };
}

async function readRows<T>(
  db: RpcClient,
  fn: string,
  schema: z.ZodType<T>,
): Promise<T[] | null> {
  const { data, error } = await db.rpc(fn);
  if (error) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_read_failed",
      "Reconcile read failed",
      {
        fn,
        error: error.message,
      },
    );
    return null;
  }
  const parsed = z.array(schema).safeParse(data ?? []);
  if (!parsed.success) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_read_malformed",
      "Reconcile read returned an unexpected shape",
      {
        fn,
        issues: parsed.error.issues.length,
      },
    );
    return null;
  }
  return parsed.data;
}

const defaultPause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function reconcileMarketingContacts(
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const db = options.db ?? supabaseServer;
  const contacts = options.contacts ?? defaultContactsTransport();
  const pause = options.pause ?? defaultPause;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const requestId = options.requestId;
  const summary = emptySummary();

  // ── 1. Read. Any failure stops the run before a single write. ─────────────────────────
  const env = marketingEmailEnvSchema.safeParse(options.env ?? process.env);
  const studentsId = env.success
    ? env.data.RESEND_SEGMENT_ID_STUDENTS
    : undefined;
  const guardiansId = env.success
    ? env.data.RESEND_SEGMENT_ID_GUARDIANS
    : undefined;
  if (!studentsId || !guardiansId || studentsId === guardiansId) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_config_missing",
      "Marketing segment ids are not configured",
      {
        requestId,
      },
    );
    return { ...summary, aborted: "config_missing" };
  }
  const segmentIds: SegmentIds = {
    students: studentsId,
    guardians: guardiansId,
  };

  const audience = await readRows(
    db,
    "marketing_email_audience",
    audienceRowSchema,
  );
  const known = await readRows(
    db,
    "marketing_email_contacts_list",
    knownRowSchema,
  );
  if (audience === null || known === null)
    return { ...summary, aborted: "read_failed" };
  summary.eligible = audience.length;

  const segments = await contacts.listSegments();
  if (!segments.ok) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_read_failed",
      "Could not list Resend segments",
      {
        requestId,
        kind: segments.error.kind,
        status: segments.error.status,
      },
    );
    return { ...summary, aborted: "read_failed" };
  }
  const present = new Set(segments.value.map((s: ResendSegment) => s.id));
  if (!present.has(studentsId) || !present.has(guardiansId)) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_segment_missing",
      "A configured marketing segment does not exist in Resend",
      {
        requestId,
        studentsPresent: present.has(studentsId),
        guardiansPresent: present.has(guardiansId),
      },
    );
    return { ...summary, aborted: "segment_missing" };
  }
  // The guard on the audience: the two synced segments are the only marketing audience. Any
  // other segment is a list someone built by hand; it is reported, never trusted or edited.
  const foreign = segments.value.filter(
    (s) => s.id !== studentsId && s.id !== guardiansId,
  );
  summary.foreignSegments = foreign.length;
  if (foreign.length > 0) {
    logger.error(
      "MARKETING_EMAIL",
      "foreign_segment_present",
      "Resend holds a segment the reconcile does not own; marketing broadcasts must target only the synced segments",
      {
        requestId,
        segmentIds: foreign.map((s) => s.id),
      },
    );
  }

  const all = await contacts.listContacts({});
  const inStudents = await contacts.listContacts({ segmentId: studentsId });
  const inGuardians = await contacts.listContacts({ segmentId: guardiansId });
  if (!all.ok || !inStudents.ok || !inGuardians.ok) {
    logger.error(
      "MARKETING_EMAIL",
      "reconcile_read_failed",
      "Could not list Resend contacts",
      {
        requestId,
      },
    );
    return { ...summary, aborted: "read_failed" };
  }

  // ── 2. Plan. ─────────────────────────────────────────────────────────────────────────
  const plan = planMarketingReconcile({
    audience,
    known,
    contacts: all.value,
    members: {
      students: new Set(inStudents.value.map((c) => c.id)),
      guardians: new Set(inGuardians.value.map((c) => c.id)),
    },
  });

  // ── 3. Apply: unsubscribes back first, then deletions, then creations. ───────────────
  let writes = 0;
  const budget = (): boolean => {
    if (
      writes >= MAX_WRITES_PER_RUN ||
      now() - startedAt > RUN_WRITE_DEADLINE_MS
    ) {
      summary.deferred += 1;
      return false;
    }
    writes += 1;
    return true;
  };

  const optOutFailed = new Set<string>();
  for (const item of plan.optOut) {
    const { data, error } = await db.rpc("apply_marketing_email_optout", {
      p_provider_event_id: `reconcile:${item.contactId}`,
      p_event_type: "reconcile.unsubscribed",
      p_resend_contact_id: item.contactId,
      p_email: item.email,
    });
    const outcome = optOutOutcomeSchema.safeParse(data);
    if (error || !outcome.success) {
      // The contact keeps its unsubscribe until the opt-out lands: it is NOT deleted this run.
      optOutFailed.add(item.contactId);
      summary.failed += 1;
      logger.error(
        "MARKETING_EMAIL",
        "reconcile_optout_failed",
        "Could not bring an unsubscribe back; the contact is kept until it lands",
        {
          requestId,
          contactId: item.contactId,
          error: error?.message ?? "unexpected outcome",
        },
      );
      continue;
    }
    if (outcome.data === "applied") summary.optedOut += 1;
  }

  for (const item of plan.delete) {
    if (optOutFailed.has(item.contactId)) continue;
    if (!budget()) continue;
    await pause(RESEND_CALL_SPACING_MS);
    const result = await contacts.deleteContact(item.contactId, {
      recipientProfileId: item.profileId,
    });
    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    summary.deleted += 1;
  }

  for (const item of plan.create) {
    if (!budget()) continue;
    await pause(RESEND_CALL_SPACING_MS);
    const result = await contacts.createContact(
      item.email,
      segmentIds[item.segment],
      {
        recipientProfileId: item.profileId,
      },
    );
    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    const { error } = await db.rpc("marketing_email_contact_record", {
      p_profile_id: item.profileId,
      p_resend_contact_id: result.value.id,
      p_segment: item.segment,
    });
    if (error) {
      summary.failed += 1;
      logger.error(
        "MARKETING_EMAIL",
        "reconcile_record_failed",
        "Contact created but not recorded; tomorrow's run records it",
        {
          requestId,
          contactId: result.value.id,
          error: error.message,
        },
      );
      continue;
    }
    summary.created += 1;
  }

  for (const item of plan.record) {
    const { error } = await db.rpc("marketing_email_contact_record", {
      p_profile_id: item.profileId,
      p_resend_contact_id: item.contactId,
      p_segment: item.segment,
    });
    if (error) {
      summary.failed += 1;
      continue;
    }
    summary.recorded += 1;
  }

  for (const contactId of plan.forget) {
    const { error } = await db.rpc("marketing_email_contact_forget", {
      p_resend_contact_id: contactId,
    });
    if (error) {
      summary.failed += 1;
      continue;
    }
    summary.forgotten += 1;
  }

  const purged = await db.rpc("marketing_email_webhook_events_purge");
  if (purged.error) {
    summary.failed += 1;
  } else {
    summary.purgedEvents = typeof purged.data === "number" ? purged.data : 0;
  }

  summary.ok = summary.failed === 0;
  logger.info(
    "MARKETING_EMAIL",
    "reconcile_completed",
    "Marketing contact reconcile finished",
    {
      requestId,
      ...summary,
    },
  );
  return summary;
}

/**
 * Account deletion's Resend step (owner brief scope 3): remove the person's contact by address.
 * Called by the deletion executor with the address it already holds for one loop iteration
 * (contract C0.6); never throws, never logs the address. A failure is logged and left to the
 * daily reconcile, which deletes every contact no eligible profile backs.
 */
export async function removeMarketingContactForDeletion(
  address: string,
  contacts: ContactsTransport = defaultContactsTransport(),
): Promise<"deleted" | "absent" | "failed"> {
  const result = await contacts.deleteContact(address, {
    recipientProfileId: null,
  });
  if (!result.ok) return "failed";
  return result.value.deleted ? "deleted" : "absent";
}
