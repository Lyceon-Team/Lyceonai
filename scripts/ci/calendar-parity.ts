#!/usr/bin/env tsx
/**
 * Doc 05F calendar — parity gate.
 *
 * @spec [Doc_05F_formula_sheet.md §6 "Parity gate"; Doc-05F_V1.0 §10.3 validator;
 *        INV-08-06 as amended by sheet §8 item 7]
 *
 * docs/Spec/calendar_formula_reference.py is the oracle, as validation_sweep.py
 * is for Doc 04B. This gate runs every committed fixture and the seeded
 * suite — suite(N, seed) and suite_fallback(N, seed), regenerated from
 * rand_snapshot and never stored — through BOTH the reference and the PL/pgSQL
 * RPCs, and fails on any byte difference or any suite violation.
 *
 * THE ORACLE IS ONE FILE. It and the fixtures are read from docs/Spec/ directly.
 * There used to be a second copy under scripts/ci/ and a byte-identity check
 * guarding the pair; the pair was the defect and the check was a workaround for
 * it. A single file cannot drift from itself, so the check has nothing left to
 * detect and is gone along with the copies (owner ruling, 2026-09-17).
 *
 * There is also no domain-name mapping. The oracle, the fixtures and the RPCs
 * all speak the canonical eight names in full — a translation step between the
 * oracle and the database is a place for a difference to hide, which is the
 * opposite of what a parity gate is for.
 *
 * It checks six things:
 *   1. calendar_runtime_config carries exactly the oracle's constants, so a
 *      config edit that diverges from the formula fails CI instead of silently
 *      changing every student's plan.
 *   2. Each fixture's stored output still reproduces from the reference —
 *      including its `exam_placement` block.
 *   3. calendar_compute_plan and calendar_compute_plan_fallback reproduce the
 *      reference byte-for-byte on every case, mix ORDER included.
 *   4. The per-domain explanation keys — the oracle's fifth tuple element,
 *      which the fixtures do not store — match the RPC's scope.mix entries.
 *  4b. calendar_place_full_lengths' OWN return — `placed` and `suppressed` both —
 *      matches the oracle's Step 2, on every case. This one is not redundant with
 *      (3): `generate()` drops `exam_dates`' second value, so a suppression never
 *      reaches a plan and the whole suppression rule was invisible here. See the
 *      ExamPlacement type below for what that cost.
 *   5. calendar_validate_plan accepts every generated plan.
 *
 * Both counters are self-checked at the end: a comparison that stops running is a
 * failure, not a quiet pass.
 *
 * The gate runs against PostgreSQL 17 in CI, matching prod: security_invoker
 * semantics and integer-division edges are exactly what it exists to prove.
 *
 * Connection via standard PG* env. Usage:
 *   tsx scripts/ci/calendar-parity.ts [--suite-n 3000] [--suite-seed 1]
 */
/* eslint-disable no-console -- CI gate: its console output IS its interface, and the
   14 statements this rule already flagged here are every line an operator reads when
   the gate fails. Disabled at the file, in the same form scripts/probe/*.ts uses, rather
   than one disable-next-line per report line. The standing rule is that a wave
   lint-cleans the files it touches. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// pg ships no types and @types/pg is not a dependency here; scripts/ci/types/pg.d.ts
// declares the narrow surface these gates use, so nothing below is implicitly `any`.
import { Client } from 'pg';

type PgClient = InstanceType<typeof Client>;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EMITTER = path.join(ROOT, 'scripts', 'ci', 'reference', 'calendar_parity_emit.py');
const PYTHON = process.env.PYTHON ?? 'python3';
const BATCH = 250;

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type BlockMix = Record<string, number> | null;
type SerializedBlock = [string, BlockMix, number, string];
type SerializedPlan = Record<string, SerializedBlock[]>;
/**
 * Step 2's return, BOTH halves — `placed` keyed by date, `suppressed` a list of them.
 *
 * WHY THIS IS HERE AT ALL. The oracle's `generate()` does
 * `exams, _suppressed = exam_dates(...)` and drops the second value, so no plan this
 * gate compares can witness a suppression: the whole suppression rule was invisible to
 * parity by construction. Every fixture carried an `exam_placement` block and nothing in
 * the repository read it, which made `exam_both_occurrences_overridden_suppressed` a
 * fixture that could only witness the ABSENCE of a block on a date — a claim that passes
 * identically whether the rule suppressed correctly, used the wrong anchor, or hit the
 * cap. Brief 18's census measured it: deleting the suppression arm changed 0 of 13
 * fixtures and 0 of 3000 suite cases (docs/plans/Calendar_Rule_Branch_Coverage_Census.md).
 */
type ExamPlacement = { placed: Record<string, string>; suppressed: string[] };

type ParityCase = {
  name: string;
  snapshot: Record<string, JsonValue>;
  deterministic_v1: SerializedPlan;
  fallback_v1: SerializedPlan;
  deterministic_v1_explanations: Record<string, Record<string, string>>;
  exam_placement: ExamPlacement;
  stored?: {
    deterministic_v1: SerializedPlan;
    fallback_v1: SerializedPlan;
    exam_placement: ExamPlacement;
  };
};

type PlanBlock = {
  block_type: string;
  section: string | null;
  scope: { level?: string; count?: number; mix?: { domain: string; count: number; explanation_key: string }[] };
  target_count: number;
  explanation_key: string;
};
type PlanDay = { date: string; blocks: PlanBlock[] };
type Plan = { generator: string; days: PlanDay[] };
type ValidatorResult = { result: string; violations?: JsonValue };
/** `calendar_place_full_lengths`' own jsonb: `placed` an array, `suppressed` dates. */
type RpcPlacement = {
  placed?: { date: string; explanation_key: string }[] | null;
  suppressed?: string[] | null;
};
type ParityRow = {
  idx: string;
  det: Plan;
  fb: Plan;
  fl: RpcPlacement;
  vdet: ValidatorResult;
  vfb: ValidatorResult;
};

const failures: string[] = [];
let comparisons = 0;
let placementComparisons = 0;

function fail(message: string): void {
  failures.push(message);
  if (failures.length <= 12) console.error(`  FAIL ${message}`);
}

/** Runs the emitter, which imports the oracle without modifying it. */
function emit(args: string[]): string {
  const r = spawnSync(PYTHON, [EMITTER, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`calendar_parity_emit.py ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
  }
  return r.stdout;
}

function emitCases(args: string[]): ParityCase[] {
  return emit(args)
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ParityCase);
}

/**
 * The RPC plan, reduced to the fixtures' four-element serialization.
 *
 * A weighted practice block's mix is an ARRAY in the database because jsonb
 * sorts object keys and allocation order is meaningful. Rebuilding an object
 * here in array order reproduces the oracle's insertion order exactly, and
 * JSON.stringify then preserves it, so the comparison is order-sensitive.
 */
function project(plan: Plan): SerializedPlan {
  const out: SerializedPlan = {};
  for (const day of plan.days) {
    out[day.date] = day.blocks.map((b): SerializedBlock => {
      let mix: BlockMix = null;
      if (b.block_type === 'practice') {
        mix = {};
        if (b.scope.level === 'domain') {
          for (const e of b.scope.mix ?? []) {
            mix[e.domain] = e.count;
          }
        } else {
          if (b.section === null) throw new Error('section-level practice block with no section');
          mix[b.section] = b.scope.count ?? -1;
        }
      }
      return [b.block_type, mix, b.target_count, b.explanation_key];
    });
  }
  return out;
}

/**
 * `calendar_place_full_lengths`' return, reduced to the fixtures' `exam_placement` shape.
 *
 * `placed` is an ARRAY in the database (jsonb sorts object keys, and the RPC builds it in
 * placement order); the oracle keys it by date. Both sides go through `canonPlacement`
 * below, so the comparison is about the dates and their explanation keys and not about
 * the order two languages happened to build a map in.
 */
function projectPlacement(fl: RpcPlacement): ExamPlacement {
  const placed: Record<string, string> = {};
  for (const e of fl.placed ?? []) placed[e.date] = e.explanation_key;
  return { placed, suppressed: [...(fl.suppressed ?? [])] };
}

/** Both sides, key-sorted, as one string — so a diff is a diff and nothing else. */
function canonPlacement(p: ExamPlacement): string {
  const placed = Object.keys(p.placed)
    .sort()
    .map((k) => [k, p.placed[k]]);
  return JSON.stringify({ placed, suppressed: [...p.suppressed].sort() });
}

/** The oracle's fifth tuple element: per-domain explanation keys, by "date#index". */
function projectExplanations(plan: Plan): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const day of plan.days) {
    day.blocks.forEach((b, i) => {
      if (b.block_type !== 'practice' || b.scope.level !== 'domain') return;
      const m: Record<string, string> = {};
      for (const e of b.scope.mix ?? []) {
        m[e.domain] = e.explanation_key;
      }
      out[`${day.date}#${i}`] = m;
    });
  }
  return out;
}

/**
 * Order-insensitive comparison of the explanation maps.
 *
 * The oracle builds its fifth element from a dict comprehension over `mix`, so
 * its key order already matches; comparing sorted keys here keeps the check
 * about the VALUES, which is what it is for. Block order and mix order are
 * already proved byte-exact by project().
 */
function sameExplanations(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a[k] === b[k]);
}

async function checkConstants(client: PgClient): Promise<void> {
  const before = failures.length;
  const expected = JSON.parse(emit(['constants'])) as Record<string, JsonValue>;
  const { rows } = await client.query<{ key: string; value: JsonValue }>(
    'SELECT key, value FROM public.calendar_runtime_config',
  );
  const actual = new Map<string, JsonValue>(rows.map((r): [string, JsonValue] => [r.key, r.value]));
  for (const [key, want] of Object.entries(expected)) {
    if (!actual.has(key)) {
      fail(`calendar_runtime_config is missing '${key}', which the oracle uses`);
      continue;
    }
    const got = JSON.stringify(actual.get(key));
    if (got !== JSON.stringify(want)) {
      fail(`calendar_runtime_config.${key} = ${got}, oracle has ${JSON.stringify(want)}`);
    }
  }
  const added = failures.length - before;
  console.log(
    added === 0
      ? `    OK calendar_runtime_config matches the oracle on all ${Object.keys(expected).length} formula constants`
      : `    FAIL calendar_runtime_config diverges from the oracle on ${added} of ${Object.keys(expected).length} formula constants`,
  );
}

/** Set from the fixture file when the fixture pass runs; the self-check below reads it. */
let fixtureCount = 0;

async function runCases(client: PgClient, label: string, cases: ParityCase[]): Promise<void> {
  const before = failures.length;
  for (let off = 0; off < cases.length; off += BATCH) {
    const part = cases.slice(off, off + BATCH);
    const { rows } = await client.query<ParityRow>(
      `SELECT t.idx::text AS idx, p.det AS det, p.fb AS fb, p.fl AS fl, v.vdet AS vdet, v.vfb AS vfb
         FROM (SELECT s, idx,
                      ARRAY(SELECT jsonb_array_elements_text(s -> 'enabled_block_types')) AS enabled
                 FROM unnest($1::jsonb[]) WITH ORDINALITY AS u(s, idx)) t,
         LATERAL (SELECT public.calendar_compute_plan(t.s) AS det,
                         public.calendar_compute_plan_fallback(t.s) AS fb,
                         public.calendar_place_full_lengths(t.s) AS fl) p,
         LATERAL (SELECT public.calendar_validate_plan('generated', t.s,
                           pg_temp.parity_narrow(
                             public.calendar_plan_to_output(p.det, 'parity', t.enabled), t.s)) AS vdet,
                         public.calendar_validate_plan('generated', t.s,
                           pg_temp.parity_narrow(
                             public.calendar_plan_to_output(p.fb, 'parity', t.enabled), t.s)) AS vfb) v
        ORDER BY t.idx`,
      [part.map((c) => JSON.stringify(c.snapshot))],
    );
    if (rows.length !== part.length) {
      throw new Error(`batch at ${off}: expected ${part.length} rows, got ${rows.length}`);
    }
    rows.forEach((row: ParityRow, i: number) => {
      const c = part[i];
      if (c === undefined) throw new Error(`batch at ${off}: no case for row ${i}`);

      // (2) the stored fixture still reproduces from the reference
      if (c.stored !== undefined) {
        for (const g of ['deterministic_v1', 'fallback_v1'] as const) {
          if (JSON.stringify(c[g]) !== JSON.stringify(c.stored[g])) {
            fail(`${c.name}/${g}: the reference no longer reproduces the stored fixture`);
          }
        }
        const wantStored = canonPlacement(c.stored.exam_placement);
        const gotRef = canonPlacement(c.exam_placement);
        if (wantStored !== gotRef) {
          fail(
            `${c.name}/exam_placement: the reference no longer reproduces the stored block` +
              `\n      stored = ${wantStored}\n      ref    = ${gotRef}`,
          );
        }
      }

      // (3) byte-equality, mix order included
      comparisons += 2;
      for (const [g, plan] of [['deterministic_v1', row.det], ['fallback_v1', row.fb]] as const) {
        const got = JSON.stringify(project(plan));
        const want = JSON.stringify(c[g]);
        if (got !== want) {
          const gotDays = JSON.parse(got) as SerializedPlan;
          const wantDays = JSON.parse(want) as SerializedPlan;
          const day = Object.keys(wantDays).find(
            (k) => JSON.stringify(gotDays[k]) !== JSON.stringify(wantDays[k]),
          );
          fail(
            `${c.name}/${g}: RPC differs from the oracle` +
              (day === undefined
                ? ''
                : `\n      ${day}\n      rpc = ${JSON.stringify(gotDays[day])}\n      ref = ${JSON.stringify(wantDays[day])}`),
          );
        }
      }

      // (4) the oracle's unpersisted fifth element
      const gotEx = projectExplanations(row.det);
      const wantEx = c.deterministic_v1_explanations;
      const exKeys = new Set([...Object.keys(gotEx), ...Object.keys(wantEx)]);
      for (const k of exKeys) {
        const a = gotEx[k];
        const b = wantEx[k];
        if (a === undefined || b === undefined || !sameExplanations(a, b)) {
          fail(`${c.name}: per-domain explanation keys differ at ${k}: rpc=${JSON.stringify(a)} ref=${JSON.stringify(b)}`);
        }
      }

      // (4b) THE SUPPRESSION LIST, compared against the RPC's own return rather than
      // against the plan — which is the only place it appears at all. This runs on every
      // case, fixture and suite alike, so the arms of the override rule are now held on
      // every input this gate sees instead of on none.
      placementComparisons += 1;
      const gotPlacement = canonPlacement(projectPlacement(row.fl));
      const wantPlacement = canonPlacement(c.exam_placement);
      if (gotPlacement !== wantPlacement) {
        fail(
          `${c.name}/exam_placement: calendar_place_full_lengths differs from the oracle` +
            `\n      rpc = ${gotPlacement}\n      ref = ${wantPlacement}`,
        );
      }

      // (5) the validator accepts what the generators produce
      for (const [g, v] of [['deterministic_v1', row.vdet], ['fallback_v1', row.vfb]] as const) {
        if (v.result !== 'accepted') {
          fail(`${c.name}/${g}: calendar_validate_plan rejected a generated plan: ${JSON.stringify(v.violations)}`);
        }
      }
    });
  }
  const added = failures.length - before;
  console.log(`    ${added === 0 ? 'OK' : 'FAIL'} ${label}: ${cases.length} snapshot(s), ${cases.length * 2} plan(s)${added === 0 ? '' : `, ${added} failure(s)`}`);
}

function checkSuiteViolations(n: number, seed: number): void {
  const res = JSON.parse(emit(['suite-violations', String(n), String(seed)])) as Record<
    string,
    { violations: Record<string, number> }
  >;
  for (const [g, r] of Object.entries(res)) {
    const v = Object.keys(r.violations);
    if (v.length > 0) {
      fail(`${g}: the oracle's own property suite reported violations ${JSON.stringify(r.violations)}`);
    } else {
      console.log(`    OK ${g}: suite(N=${n}, seed=${seed}) reports zero violations`);
    }
  }
}

function intArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const raw = process.argv[i + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a non-negative integer, got ${String(raw)}`);
  return n;
}

async function main(): Promise<void> {
  const suiteN = intArg('--suite-n', 3000);
  const suiteSeed = intArg('--suite-seed', 1);

  const client = new Client({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? '5432'),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'postgres',
  });
  await client.connect();

  // WHY THE VALIDATED OUTPUT IS NARROWED, AND ONLY THE VALIDATED ONE.
  //
  // calendar_persist_version does not validate what calendar_compute_plan produced. It
  // validates that output after THREE filters -- calendar_carry_started,
  // calendar_drop_today_for_system and calendar_drop_unowned_dates -- and the last of
  // those removes any date `generated_for.dates` does not name, "chiefly one the student
  // has overridden" (its own COMMENT). The generator deliberately walks the whole horizon
  // and never reads generated_for.dates, so overridden dates leave it and are dropped
  // downstream, before any validator sees them.
  //
  // This gate used not to send `current_overrides` at all, so V-14 ("generated may not
  // take over a date the student has overridden") could never fire here. Now that
  // placement needs overrides, the snapshot carries them -- and validating the RAW output
  // made the gate assert something production never does: 372 of 424 comparisons failed
  // on V-14 while the plans themselves matched the oracle exactly.
  //
  // So the narrowing is applied to the output fed to the validator, and NOT to the plan
  // compared against the oracle: the oracle plans those dates too, and hiding them from
  // the comparison would weaken the very thing this gate exists to check. pg_temp keeps
  // the helper session-local, so nothing is added to the database under test.
  await client.query(`
    CREATE FUNCTION pg_temp.parity_narrow(p_output jsonb, p_input jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE AS $fn$
      SELECT jsonb_set(p_output, '{dates}', COALESCE((
        SELECT jsonb_agg(d ORDER BY d ->> 'scheduled_date')
        FROM jsonb_array_elements(COALESCE(p_output -> 'dates', '[]'::jsonb)) d
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
                     COALESCE(p_input -> 'current_overrides', '[]'::jsonb)) o
           WHERE (o ->> 'is_user_override')::boolean
             AND (o ->> 'scheduled_date') = (d ->> 'scheduled_date'))
      ), '[]'::jsonb))
    $fn$;`);
  try {
    const { rows } = await client.query<{ v: string; major: string }>(
      "SELECT version() AS v, split_part(current_setting('server_version'), '.', 1) AS major",
    );
    console.log(`==> ${rows[0]?.v ?? 'unknown server'}`);

    // The sheet §6 requires this gate to run on the prod major: security_invoker
    // semantics and integer-division edges are what it exists to prove. CI sets
    // the variable, so a misconfigured service container fails loudly instead of
    // passing against the wrong server.
    const requiredMajor = process.env.CALENDAR_PARITY_REQUIRE_PG_MAJOR;
    if (requiredMajor !== undefined && requiredMajor !== '') {
      const major = rows[0]?.major;
      if (major !== requiredMajor) {
        throw new Error(
          `this gate must run on PostgreSQL ${requiredMajor} (formula sheet §6); the server reports major ${String(major)}`,
        );
      }
      console.log(`    OK server major is ${major}, as required`);
    }

    console.log('==> calendar_runtime_config vs the oracle constants');
    await checkConstants(client);

    const fixtureCases = emitCases(['fixtures']);
    // The COUNT COMES FROM THE FILE, never a literal. It read `9` in two places and the
    // owner's twelfth fixture made both wrong at once -- one of them the self-check that
    // exists to catch a gate which silently compared nothing.
    fixtureCount = fixtureCases.length;
    console.log(`==> ${fixtureCount} committed fixtures`);
    await runCases(client, 'fixtures', fixtureCases);

    console.log(`==> seeded suite (N=${suiteN}, seed=${suiteSeed}), regenerated, never stored`);
    await runCases(client, 'suite', emitCases(['suite', String(suiteN), String(suiteSeed)]));

    console.log('==> the oracle checks itself');
    checkSuiteViolations(suiteN, suiteSeed);
  } finally {
    await client.end();
  }

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} parity failure(s) over ${comparisons} plan comparisons`);
    process.exit(1);
  }
  // A gate that compared nothing exits 0 and proves nothing. Refuse that.
  const expected = (fixtureCount + suiteN) * 2;
  if (comparisons !== expected) {
    console.error(`\nFAIL: compared ${comparisons} plans, expected ${expected} — the gate did not run what it claims to run`);
    process.exit(1);
  }
  // The same rule for the placement comparison, counted separately: it is one per case,
  // not two, and an `exam_placement` block that stopped being read is exactly the state
  // this comparison was added to end.
  const expectedPlacements = fixtureCount + suiteN;
  if (placementComparisons !== expectedPlacements) {
    console.error(`\nFAIL: compared ${placementComparisons} exam_placement blocks, expected ${expectedPlacements} — the placement comparison did not run`);
    process.exit(1);
  }
  console.log(`\nOK: ${comparisons} plan comparisons and ${placementComparisons} exam_placement comparisons, byte-exact against the oracle`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
