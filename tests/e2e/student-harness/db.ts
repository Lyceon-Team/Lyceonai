/**
 * The student screenshot harness's database.
 *
 * @spec [student-UI register §6 Wave 5; CLAUDE.md "derive the fixture from real output"]
 * @implemented [2026-10-03]
 *
 * plain English: the exam harness's database (this repo's migrations, two published forms of
 * readable questions, the paid student with a premium/active entitlement, a linked guardian, a
 * finished calendar setup) built under its own name, plus the free student. Only identity rows
 * are written here: accounts, profiles, the date of birth (the real trigger derives the age
 * fields) and profile completion, which production writes through Supabase Auth and the
 * onboarding form. Learning history is NOT written here: the server seeds it after start-up
 * through the real practice routes (see seed.ts), so the pages render payloads the real
 * producers made.
 */
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { z } from "zod";
import { buildHarnessDb, makeHarnessForm } from "../exam-harness/db";
import { BARE_PAGE_PERSONAS, PERSONAS } from "./personas";

/**
 * The throwaway database's name. `STUDENT_HARNESS_DB` overrides it so two page groups can be
 * captured at once (with their own `HARNESS_PORT` and `STUDENT_HARNESS_VITE_PORT`) without one
 * run dropping the other's database.
 */
export const STUDENT_HARNESS_DB =
  process.env.STUDENT_HARNESS_DB ?? "student_e2e_harness";

/** UI-54 (`seed: "exam-history"`): the form the paid student has never taken. */
const EXAM_HISTORY_THIRD_FORM = {
  id: "e7b00000-0000-4000-8000-0000000000f3",
  tag: "E3",
  name: "Practice Test 3",
} as const;

const TAXONOMY_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
  "content",
  "canonical",
  "taxonomy.json",
);

const taxonomySchema = z.object({
  skills: z.record(z.string(), z.array(z.string().min(1)).min(1)),
});

/**
 * UI-57 (`seed: "mastery-skills"`): the harness bank tags every question with the CI fixture's
 * one placeholder skill (`exg-fixture`), so the Mastery page's skills list would show a single
 * made-up row. This retags the bank, before any learning history exists, with the canonical
 * skills of each question's own domain (`content/canonical/taxonomy.json`, the tree the real bank
 * is authored against), by question id: two in three questions carry the domain's first skill and the rest
 * cycle through its others, so a short history can measure one skill and leave the rest
 * unmeasured. It is bank CONTENT, like the readable stems
 * `makeHarnessForm` writes; no mastery row is written. The base seed's answers then produce the
 * mastery through the real answer path, so some skills are measured and others are not.
 */
async function useCanonicalSkills(pg: Client): Promise<void> {
  const taxonomy = taxonomySchema.parse(
    JSON.parse(fs.readFileSync(TAXONOMY_PATH, "utf8")),
  );
  for (const [domain, skills] of Object.entries(taxonomy.skills)) {
    await pg.query(
      `UPDATE public.questions q
          SET skill_codes = ARRAY[
                CASE WHEN r.n % 3 <> 0 OR cardinality($2::text[]) = 1 THEN ($2::text[])[1]
                     ELSE ($2::text[])[2 + ((r.n / 3 - 1) % (cardinality($2::text[]) - 1))]
                END]
         FROM (SELECT id, row_number() OVER (ORDER BY id) AS n
                 FROM public.questions WHERE domain = $1) r
        WHERE q.id = r.id`,
      [domain, skills],
    );
  }
}

export async function buildStudentHarnessDb(): Promise<Client> {
  const pg = await buildHarnessDb(STUDENT_HARNESS_DB);
  if (process.env.STUDENT_HARNESS_SEED === "exam-history") {
    // UI-54: a third published form, never taken, so the Full-Length list shows "Not started"
    // beside the scored and the in-progress test (FullLength.dc.html has all three). Built by
    // the same CI form fixture and readable content as the exam harness's two.
    await makeHarnessForm(pg, EXAM_HISTORY_THIRD_FORM);
  }
  if (process.env.STUDENT_HARNESS_SEED === "mastery-skills") {
    await useCanonicalSkills(pg);
  }
  // The paid student comes from the exam harness's database; the others are built here.
  for (const persona of [PERSONAS.free, PERSONAS.managed]) {
    await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, [
      persona.id,
      persona.email,
    ]);
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1::uuid, $2, 'student', $3)`,
      [persona.id, persona.email, persona.displayName],
    );
  }
  // UI-58: the guardian-managed student (F-40). A subscription id on the student's own
  // entitlement and no Stripe customer on the profile: the route's `managedBy` reads `guardian`.
  // The id is a harness label, never sent anywhere (nothing here calls Stripe).
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id)
       VALUES ($1::uuid, 'premium', 'active', 'sub_harness_guardian_paid')`,
    [PERSONAS.managed.id],
  );
  for (const persona of Object.values(PERSONAS)) {
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = $2::date, profile_completed_at = '2026-09-01T00:00:00Z'
        WHERE id = $1::uuid`,
      [persona.id, persona.dateOfBirth],
    );
  }
  // The answer rate limit (Doc 02B §14, practice_runtime_config, 30 per minute) is keyed by IP,
  // and every persona's seed answers come from this one local address (about 70 in a few
  // seconds). Raised in this throwaway database only, through the config row the route reads.
  await pg.query(
    `UPDATE public.practice_runtime_config SET value = '1000' WHERE key = 'answer_rate_limit_max'`,
  );
  const check = await pg.query<{ id: string; is_under_13: boolean | null }>(
    `SELECT id, is_under_13 FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [Object.values(PERSONAS).map((p) => p.id)],
  );
  for (const row of check.rows) {
    if (row.is_under_13 !== false) {
      throw new Error(
        `persona ${row.id} is not a known 13+ student (is_under_13=${String(row.is_under_13)})`,
      );
    }
  }
  if (process.env.STUDENT_HARNESS_SEED === "bare-pages") {
    await addBarePagePersonas(pg);
  }
  return pg;
}

/** A date of birth `years` years before today (UTC), as YYYY-MM-DD. */
function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * UI-59 (`seed: "bare-pages"`): the three bare-page personas (personas.ts BARE_PAGE_PERSONAS).
 * Identity rows only, as above, plus the one lifecycle write production makes through SQL: the
 * pending deletion is the REAL `request_account_deletion` function (soft-delete and a pending
 * request row in one transaction), never a hand-written row. Its recovery-token hash is a fixed
 * harness label; no recovery link is ever built from it. Each state is then checked as the
 * profile route will read it, so a migration that changes the trigger or the writer fails here
 * rather than producing a screenshot of the wrong page.
 */
async function addBarePagePersonas(pg: Client): Promise<void> {
  for (const persona of Object.values(BARE_PAGE_PERSONAS)) {
    await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, [
      persona.id,
      persona.email,
    ]);
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1::uuid, $2, 'student', $3)`,
      [persona.id, persona.email, persona.displayName],
    );
  }
  // under13: eleven years old today, profile complete, no guardian link.
  await pg.query(
    `UPDATE public.profiles SET date_of_birth = $2::date, profile_completed_at = '2026-09-01T00:00:00Z'
      WHERE id = $1::uuid`,
    [BARE_PAGE_PERSONAS.under13.id, birthDateYearsAgo(11)],
  );
  // deleting: sixteen, profile complete, then the real deletion request.
  await pg.query(
    `UPDATE public.profiles SET date_of_birth = $2::date, profile_completed_at = '2026-09-01T00:00:00Z'
      WHERE id = $1::uuid`,
    [BARE_PAGE_PERSONAS.deleting.id, birthDateYearsAgo(16)],
  );
  await pg.query(
    `SELECT * FROM public.request_account_deletion($1::uuid, $1::uuid, $2, 7)`,
    [BARE_PAGE_PERSONAS.deleting.id, "student-harness-not-a-real-token-hash"],
  );
  const states = await pg.query<{
    id: string;
    is_under_13: boolean | null;
    completed: boolean;
    deleted: boolean;
    pending: boolean;
  }>(
    `SELECT p.id, p.is_under_13, p.profile_completed_at IS NOT NULL AS completed,
            p.deleted_at IS NOT NULL AS deleted,
            EXISTS (SELECT 1 FROM public.account_deletion_requests r
                     WHERE r.profile_id = p.id AND r.status = 'pending') AS pending
       FROM public.profiles p WHERE p.id = ANY($1::uuid[])`,
    [Object.values(BARE_PAGE_PERSONAS).map((p) => p.id)],
  );
  const byId = new Map(states.rows.map((r) => [r.id, r]));
  const onboarding = byId.get(BARE_PAGE_PERSONAS.onboarding.id);
  const under13 = byId.get(BARE_PAGE_PERSONAS.under13.id);
  const deleting = byId.get(BARE_PAGE_PERSONAS.deleting.id);
  if (!onboarding || onboarding.completed)
    throw new Error("bare-pages: the onboarding persona is not incomplete");
  if (!under13 || under13.is_under_13 !== true || !under13.completed)
    throw new Error(
      "bare-pages: the under-13 persona is not a complete under-13 student",
    );
  if (
    !deleting ||
    !deleting.deleted ||
    !deleting.pending ||
    deleting.is_under_13 !== false
  )
    throw new Error("bare-pages: the deleting persona has no pending deletion");
}

/**
 * QA 2026-10-07 (`seed: "notifications"`, UI-41): three unread in-app notifications for the paid
 * student, so the bell's unread badge and the popover's items are real rows.
 *
 * @spec [contracts/notifications.contract.md §2 (one event row fans out per recipient and
 *        channel), §5 (deterministic `event_id` from `notification_event_id`), §8.1 payloads]
 *        | @implemented [2026-10-07]
 *
 * plain English: written through the REAL SQL producer, `public.emit_notification_event`, with
 * the event id from `public.notification_event_id(type, source)`, exactly as the production
 * writers call it; the payloads parse under the shared schemas' shapes (`guardian_linked`:
 * link id and display name; `full_length_*`: block id and local date). The renderers on the
 * real `GET /api/notifications` turn them into titles and bodies, so nothing here is copy. Only
 * the `in_app` channel: the harness sends no email.
 */
export async function seedPaidNotifications(pg: Client): Promise<void> {
  const paid = PERSONAS.paid.id;
  const link = await pg.query<{ id: string }>(
    `SELECT id FROM public.guardian_links
      WHERE student_profile_id = $1 AND status = 'active' LIMIT 1`,
    [paid],
  );
  const linkId = link.rows[0]?.id;
  if (linkId === undefined)
    throw new Error(
      "seedPaidNotifications: the paid student has no active guardian link",
    );
  const blockId = "00000000-0000-4000-8000-00000000a7e1";
  const events: readonly { type: string; source: string; payload: unknown }[] =
    [
      {
        type: "guardian_linked",
        source: linkId,
        payload: {
          link_id: linkId,
          student_display_name: PERSONAS.paid.displayName,
        },
      },
      {
        type: "full_length_week",
        source: blockId,
        payload: { block_id: blockId, local_date: "2026-10-17" },
      },
      {
        type: "full_length_tomorrow",
        source: blockId,
        payload: { block_id: blockId, local_date: "2026-10-17" },
      },
    ];
  for (const e of events) {
    await pg.query(
      `SELECT public.emit_notification_event(
         public.notification_event_id($1, $2), $1, $3::uuid,
         jsonb_build_array(jsonb_build_object('profile_id', $3::text, 'channels', jsonb_build_array('in_app'))),
         $4::jsonb)`,
      [e.type, e.source, paid, JSON.stringify(e.payload)],
    );
  }
}
