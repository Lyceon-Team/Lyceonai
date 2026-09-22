/**
 * Calendar block scope — the TypeScript shape of `calendar_blocks.scope`.
 *
 * @spec [Doc_05F §6 (block types and scopes), §7.4; Doc_05F_formula_sheet §1, §8 item 3;
 *        lyceon-coding-standards §3.5 (discriminated unions), §7.2 (schema first)]
 * | @implemented [2026-09-17]
 *
 * plain English: `supabase/migrations/20260917130000_calendar_v1.sql` decides what a legal
 * scope is, in the SQL function `calendar_scope_is_valid(block_type, section, scope)` that
 * backs the `calendar_blocks_scope_shape` CHECK. This module is that function restated in
 * Zod, key for key, so the server and the UI reject a bad scope at the boundary instead of
 * casting it and discovering the problem three layers later.
 *
 * expected outcome: `parseBlockScope` accepts exactly the (block_type, section, scope)
 * triples the database accepts, and names the rule that failed for the ones it does not.
 *
 * trade-offs: the schemas are no stricter than the CHECK, deliberately. A shared schema
 * that refuses a row the database happily stores turns a legal state into a 500 at read
 * time, which is worse than accepting a string the generator would never emit. Where the
 * generator IS narrower — the explanation-key vocabulary — that narrowing lives in
 * validator rule V-09 (generated mode only) and is exported here as a constant for copy
 * lookup, not folded into the shape.
 *
 * edge cases: `full_length` scope is `{form_id}` REQUIRED-PRESENT with a NULLABLE value
 * (owner ruling B3, 2026-09-17) — the key is always there, the value is null for Doc 04
 * rotation. A practice mix is an ARRAY and its order is meaningful (the migration's §18
 * comment: jsonb sorts object keys, so an object would silently re-sort the mix).
 */
import { z } from "zod";
import { masterySectionSchema, type MasterySection } from "../mastery-levels.js";
import { err, ok, type Result } from "../result.js";

// ── Sections and canonical domains ──────────────────────────────────────────

/**
 * The calendar does not define its own section enum. `masterySectionSchema` is the
 * platform's `questions.section` vocabulary and is reused verbatim (CLAUDE.md: consume the
 * canonical primitive, never fork a second one). The alias exists so calendar call sites
 * read in calendar vocabulary without a second definition behind it.
 */
export const calendarSectionSchema = masterySectionSchema;
export type CalendarSection = MasterySection;

/**
 * The canonical eight College Board domain names, in the order
 * `calendar_runtime_config.canonical_domain_order` holds them: Math first, then Reading &
 * Writing. The strings are the ones `20260816010000_canonical_domain_checks.sql` enforces
 * on `questions.domain` and `practice_session_items.question_domain`.
 *
 * This is a platform list, not a calendar list. It is sited here because the calendar is
 * the first TypeScript consumer to need it as a closed set; `server/routes/practice-topics-
 * routes.ts` holds an older array literal of the same eight in a different Reading & Writing
 * order, which should collapse into this constant when that route is next touched.
 *
 * In the calendar the ORDER is load-bearing for exactly one thing: it is the tie-break
 * between two domains with an equal deficit (formula sheet §2 step 5). Nothing else may
 * read meaning into the position.
 */
export const CANONICAL_DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem Solving and Data Analysis",
  "Geometry and Trigonometry",
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions",
] as const;

export const canonicalDomainSchema = z.enum(CANONICAL_DOMAINS);
export type CanonicalDomain = z.infer<typeof canonicalDomainSchema>;

/** Which section each canonical domain belongs to — the `IN` lists of the CHECK, inverted. */
export const DOMAIN_SECTION: Readonly<Record<CanonicalDomain, CalendarSection>> = {
  Algebra: "M",
  "Advanced Math": "M",
  "Problem Solving and Data Analysis": "M",
  "Geometry and Trigonometry": "M",
  "Information and Ideas": "RW",
  "Craft and Structure": "RW",
  "Expression of Ideas": "RW",
  "Standard English Conventions": "RW",
};

export function sectionOfDomain(domain: CanonicalDomain): CalendarSection {
  return DOMAIN_SECTION[domain];
}

// ── Explanation keys (validator V-09, generated mode only) ──────────────────

/**
 * The block-level `explanation_key` vocabulary the generators emit, copied from
 * `calendar_validate_plan`'s `c_block_keys`. V-09 enforces membership for `generated`
 * plans only, so this is NOT part of the scope shape — a student edit may carry any string
 * and the database will store it.
 *
 * FINDING (owner's, already reported with the DB layer, restated here because this module
 * is where the UI will look for copy): Doc 05F §17.6 still keys its student-facing copy to
 * the pre-sheet vocabulary (`weak_domain`, `maintain_strength`, `post_exam_focus`) and has
 * no copy at all for `taper`, `exam_review`, `exam_review_placeholder`, `weighted` or
 * `fallback`. The keys below are what the generators actually emit.
 */
export const BLOCK_EXPLANATION_KEYS = [
  "review_due",
  "exam_review",
  "exam_review_placeholder",
  "final_rehearsal",
  "exam_cadence",
  "taper",
  "cold_start",
  "weighted",
  "fallback",
] as const;
export const blockExplanationKeySchema = z.enum(BLOCK_EXPLANATION_KEYS);
export type BlockExplanationKey = z.infer<typeof blockExplanationKeySchema>;

/** The per-domain `explanation_key` vocabulary — `c_domain_keys` in the same function. */
export const DOMAIN_EXPLANATION_KEYS = [
  "weak",
  "exploring",
  "balanced",
  "strength",
  "post_exam",
] as const;
export const domainExplanationKeySchema = z.enum(DOMAIN_EXPLANATION_KEYS);
export type DomainExplanationKey = z.infer<typeof domainExplanationKeySchema>;

// ── Rule identifiers ────────────────────────────────────────────────────────

/**
 * The distinguishable ways `calendar_scope_is_valid` can say no. A rejection names one, so
 * a caller can tell "this is not a block type" from "this domain is in the wrong section"
 * without parsing prose.
 */
export const SCOPE_RULES = [
  "block_type",
  "section_presence",
  "scope_shape",
  "domain_section_match",
  "domain_unique",
] as const;
export const scopeRuleSchema = z.enum(SCOPE_RULES);
export type ScopeRule = z.infer<typeof scopeRuleSchema>;

export type ScopeRejection = {
  rule: ScopeRule;
  detail: string;
  /** Dotted path into the parsed triple, e.g. `scope.mix.0.domain`. Empty at the root. */
  path: string;
};

/**
 * Rule ids travel in the issue message rather than in `ZodIssue.params`, whose type is
 * `{[k: string]: any}` — reading it would pull `any` into this module, which §3.2 forbids.
 * A `"<rule>: <detail>"` prefix is a string, and strings are typed.
 */
function ruleMessage(rule: ScopeRule, detail: string): string {
  return `${rule}: ${detail}`;
}

// ── Practice scope (two levels, discriminated on `level`) ───────────────────

/**
 * One domain's share of a practice block. `count` mirrors the CHECK's
 * `jsonb_typeof = 'number' AND (->>'count') ~ '^[1-9][0-9]*$'`: a positive integer.
 * `explanation_key` mirrors `jsonb_typeof = 'string'` — any string, see the module header.
 */
export const practiceMixEntrySchema = z
  .object({
    domain: canonicalDomainSchema,
    count: z.number().int().positive(),
    explanation_key: z.string(),
  })
  .strict();
export type PracticeMixEntry = z.infer<typeof practiceMixEntrySchema>;

/**
 * The CHECK's final clause: `count(DISTINCT domain) = jsonb_array_length(mix)`. Kept on the
 * array rather than on the enclosing object so the object stays a `ZodObject` and can be an
 * option of a real discriminated union (a `.superRefine`d object is a `ZodEffects` and
 * `z.discriminatedUnion` will not take one).
 */
export const practiceMixSchema = z
  .array(practiceMixEntrySchema)
  .min(1)
  .superRefine((mix, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of mix.entries()) {
      if (seen.has(entry.domain)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "domain"],
          message: ruleMessage(
            "domain_unique",
            `domain ${entry.domain} appears more than once in one mix`,
          ),
        });
      }
      seen.add(entry.domain);
    }
  });

/** `{"level":"domain","mix":[…]}` — the steady-state practice block. */
export const practiceDomainScopeSchema = z
  .object({
    level: z.literal("domain"),
    mix: practiceMixSchema,
  })
  .strict();
export type PracticeDomainScope = z.infer<typeof practiceDomainScopeSchema>;

/**
 * `{"level":"section","count","explanation_key"}` — cold start and every fallback plan
 * (formula sheet §1). Load-bearing, not an edge case: a student with no mastery rows has
 * only these (owner ruling B1, 2026-09-17).
 */
export const practiceSectionScopeSchema = z
  .object({
    level: z.literal("section"),
    count: z.number().int().positive(),
    explanation_key: z.string(),
  })
  .strict();
export type PracticeSectionScope = z.infer<typeof practiceSectionScopeSchema>;

export const practiceScopeSchema = z.discriminatedUnion("level", [
  practiceDomainScopeSchema,
  practiceSectionScopeSchema,
]);
export type PracticeScope = z.infer<typeof practiceScopeSchema>;

// ── Review scope (discriminated on `mode`) ──────────────────────────────────

/** `{"mode":"queue"}` — the due queue is the scope (§6). */
export const reviewQueueScopeSchema = z
  .object({ mode: z.literal("queue") })
  .strict();
export type ReviewQueueScope = z.infer<typeof reviewQueueScopeSchema>;

/** `{"mode":"session", …}` — review of one finished engine session (sheet §8 item 13). */
export const reviewSessionScopeSchema = z
  .object({
    mode: z.literal("session"),
    source_engine: z.enum(["practice", "full_length"]),
    source_session_id: z.string(),
  })
  .strict();
export type ReviewSessionScope = z.infer<typeof reviewSessionScopeSchema>;

export const reviewScopeSchema = z.discriminatedUnion("mode", [
  reviewQueueScopeSchema,
  reviewSessionScopeSchema,
]);
export type ReviewScope = z.infer<typeof reviewScopeSchema>;

// ── Full-length scope ───────────────────────────────────────────────────────

/**
 * `{"form_id": string | null}`. The CHECK requires the key to be PRESENT
 * (`scope ?& ARRAY['form_id']`, exactly one key) and allows the value to be JSON null,
 * which means "Doc 04 rotation picks the form". Optional-key would be a different shape and
 * the database would reject it (owner ruling B3, 2026-09-17).
 */
export const fullLengthScopeSchema = z
  .object({ form_id: z.string().nullable() })
  .strict();
export type FullLengthScope = z.infer<typeof fullLengthScopeSchema>;

// ── The (block_type, section, scope) triple ─────────────────────────────────

/**
 * The three arguments of `calendar_scope_is_valid`, as one discriminated union. Section
 * presence is part of the discriminant's contract, exactly as
 * `calendar_blocks_section_by_type` states it: practice has a section, review and
 * full_length have none.
 */
export const practiceScopeTripleSchema = z
  .object({
    block_type: z.literal("practice"),
    section: calendarSectionSchema,
    scope: practiceScopeSchema,
  })
  .strict();

export const reviewScopeTripleSchema = z
  .object({
    block_type: z.literal("review"),
    section: z.null(),
    scope: reviewScopeSchema,
  })
  .strict();

export const fullLengthScopeTripleSchema = z
  .object({
    block_type: z.literal("full_length"),
    section: z.null(),
    scope: fullLengthScopeSchema,
  })
  .strict();

/**
 * The three triples as one union. Exported as objects above so `plan.ts` can `.extend` them
 * with the identity and target columns instead of restating `block_type`/`section`/`scope`
 * — one definition of the triple, two schemas that carry it.
 */
const blockScopeUnion = z.discriminatedUnion("block_type", [
  practiceScopeTripleSchema,
  reviewScopeTripleSchema,
  fullLengthScopeTripleSchema,
]);

export type CalendarBlockScope = z.infer<typeof blockScopeUnion>;

/**
 * The CHECK's per-entry section clause: `(section = 'M' AND domain IN (…math…)) OR
 * (section = 'RW' AND domain IN (…rw…))`. Cross-field, so it sits on the enclosing object
 * rather than inside the scope — the scope alone does not know its section.
 *
 * Exported as a named refinement rather than inlined so the stored-block schema in
 * `plan.ts`, which carries the same three fields plus identity columns, applies THIS rule
 * instead of restating it. Same split as `masteryLevelLabelInvariant` in
 * `mastery-levels.js`: one rule, two schemas that need it.
 */
const mixDomainProbe = z
  .object({ mix: z.array(z.object({ domain: z.string() }).passthrough()) })
  .passthrough();

function isCanonicalDomain(value: string): value is CanonicalDomain {
  return canonicalDomainSchema.safeParse(value).success;
}

export function addDomainSectionIssues(
  value: { block_type: CalendarBlockType; section: CalendarSection | null; scope: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.block_type !== "practice" || value.section === null) return;
  // The scope arrives as `unknown` so the GUARDIAN block union — whose mix entries carry no
  // explanation key — applies this same rule without a second copy of it. The probe reads
  // only what the rule needs; anything that does not have a mix has no domains to check.
  const probe = mixDomainProbe.safeParse(value.scope);
  if (!probe.success) return;
  for (const [index, entry] of probe.data.mix.entries()) {
    if (!isCanonicalDomain(entry.domain)) continue;
    if (DOMAIN_SECTION[entry.domain] !== value.section) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "mix", index, "domain"],
        message: ruleMessage(
          "domain_section_match",
          `${entry.domain} is a ${DOMAIN_SECTION[entry.domain]} domain and the block is ${value.section}`,
        ),
      });
    }
  }
}

export const calendarBlockScopeSchema =
  blockScopeUnion.superRefine(addDomainSectionIssues);

export const CALENDAR_BLOCK_TYPES = ["practice", "review", "full_length"] as const;
export const calendarBlockTypeSchema = z.enum(CALENDAR_BLOCK_TYPES);
export type CalendarBlockType = z.infer<typeof calendarBlockTypeSchema>;

/**
 * The engine that owns a block's activity. The DDL settles the vocabulary: the
 * `calendar_block_launches.engine` CHECK and the `calendar_blocks.block_type` CHECK list the
 * same three strings, so a block's engine IS its block type. Doc 05F §6 calls the third one
 * "exam" in prose; the column says `full_length` and the column wins.
 *
 * `engineOfBlock` exists so the identity is written down once. §13 speaks of `engineOf(b)`
 * as a real step, and a reader should not have to infer that it is `x => x`.
 */
export const CALENDAR_ENGINES = CALENDAR_BLOCK_TYPES;
export const calendarEngineSchema = calendarBlockTypeSchema;
export type CalendarEngine = CalendarBlockType;

export function engineOfBlock(blockType: CalendarBlockType): CalendarEngine {
  return blockType;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const RULE_BY_PATH_HEAD: Readonly<Record<string, ScopeRule>> = {
  block_type: "block_type",
  section: "section_presence",
  scope: "scope_shape",
};

function ruleOfIssue(issue: z.ZodIssue): ScopeRule {
  const separator = issue.message.indexOf(": ");
  if (separator > 0) {
    const candidate = issue.message.slice(0, separator);
    const parsed = scopeRuleSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  const head = issue.path[0];
  if (typeof head === "string") {
    const byPath = RULE_BY_PATH_HEAD[head];
    if (byPath !== undefined) return byPath;
  }
  // An issue at the root with no rule prefix is the discriminated union failing to find a
  // discriminant at all — which is the block_type rule, under a different name.
  return "block_type";
}

function detailOfIssue(issue: z.ZodIssue): string {
  const separator = issue.message.indexOf(": ");
  if (separator > 0 && scopeRuleSchema.safeParse(issue.message.slice(0, separator)).success) {
    return issue.message.slice(separator + 2);
  }
  return issue.message;
}

/**
 * Parse a stored block row's `(block_type, section, scope)` into the typed union, or say
 * which rule refused it. Expected failure, so a `Result` and never a throw
 * (Coding Standards §3.6) — and never a cast: an out-of-shape scope is a validation error.
 *
 * The first issue decides the rejection. Zod reports issues in declaration order, which is
 * the same order for the same input, so the answer is deterministic.
 */
export function parseBlockScope(
  input: unknown,
): Result<CalendarBlockScope, ScopeRejection> {
  const parsed = calendarBlockScopeSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  if (issue === undefined) {
    return err({ rule: "scope_shape", detail: "scope is not valid", path: "" });
  }
  return err({
    rule: ruleOfIssue(issue),
    detail: detailOfIssue(issue),
    path: issue.path.join("."),
  });
}

// ── The guardian projection of a scope (§16, R-08-22) ───────────────────────

/**
 * A practice scope with the explanation keys removed. §16 withholds "explanation copy" from
 * a guardian, and `explanation_key: "weak"` on an Algebra mix entry IS the explanation — it
 * says the student is weak in Algebra, which is the same class of fact as the target score
 * R-08-22 already withholds. What survives is what a guardian may legitimately see: which
 * domains the block covers and how many questions it asked for.
 */
export const guardianPracticeDomainScopeSchema = z
  .object({
    level: z.literal("domain"),
    mix: z
      .array(
        z
          .object({ domain: canonicalDomainSchema, count: z.number().int().positive() })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const guardianPracticeSectionScopeSchema = z
  .object({ level: z.literal("section"), count: z.number().int().positive() })
  .strict();

export const guardianPracticeScopeSchema = z.discriminatedUnion("level", [
  guardianPracticeDomainScopeSchema,
  guardianPracticeSectionScopeSchema,
]);
export type GuardianPracticeScope = z.infer<typeof guardianPracticeScopeSchema>;

export function toGuardianPracticeScope(scope: PracticeScope): GuardianPracticeScope {
  if (scope.level === "section") return { level: "section", count: scope.count };
  return {
    level: "domain",
    mix: scope.mix.map((entry) => ({ domain: entry.domain, count: entry.count })),
  };
}

/**
 * The review scope, minus the source-session identifiers. A guardian has no use for an
 * engine session id and no route that would accept one.
 */
export const guardianReviewScopeSchema = z
  .object({ mode: z.enum(["queue", "session"]) })
  .strict();
export type GuardianReviewScope = z.infer<typeof guardianReviewScopeSchema>;

export function toGuardianReviewScope(scope: ReviewScope): GuardianReviewScope {
  return { mode: scope.mode };
}
