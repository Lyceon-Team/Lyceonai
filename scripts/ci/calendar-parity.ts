#!/usr/bin/env tsx
/**
 * Doc 05F calendar — parity gate.
 *
 * @spec [Doc_05F_formula_sheet.md §6 "Parity gate"; Doc-05F_V1.0 §10.3 validator;
 *        INV-08-06 as amended by sheet §8 item 7]
 *
 * scripts/ci/reference/calendar_formula_reference.py is the oracle, as
 * validation_sweep.py is for Doc 04B. This gate runs the nine committed
 * fixtures and the seeded suite — suite(N, seed) and suite_fallback(N, seed),
 * regenerated from rand_snapshot and never stored — through BOTH the reference
 * and the PL/pgSQL RPCs, and fails on any byte difference or any suite
 * violation.
 *
 * It checks six things:
 *   0. The oracle exists in exactly one state. docs/Spec/ carries reader copies
 *      of the reference and the fixtures; scripts/ci/ carries the ones CI runs.
 *      Two copies of an oracle that can drift apart is not an oracle, and
 *      docs/Spec/ is read-only to Claude Code, so a divergence could only be
 *      fixed by the owner — which is exactly why it must fail loudly.
 *   1. calendar_runtime_config carries exactly the oracle's constants, so a
 *      config edit that diverges from the formula fails CI instead of silently
 *      changing every student's plan.
 *   2. Each fixture's stored output still reproduces from the reference.
 *   3. calendar_compute_plan and calendar_compute_plan_fallback reproduce the
 *      reference byte-for-byte on every case, mix ORDER included.
 *   4. The per-domain explanation keys — the oracle's fifth tuple element,
 *      which the fixtures do not store — match the RPC's scope.mix entries.
 *   5. calendar_validate_plan accepts every generated plan.
 *
 * The gate runs against PostgreSQL 17 in CI, matching prod: security_invoker
 * semantics and integer-division edges are exactly what it exists to prove.
 *
 * Connection via standard PG* env. Usage:
 *   tsx scripts/ci/calendar-parity.ts [--suite-n 3000] [--suite-seed 1]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/** The oracle abbreviates the eight domains; the database uses the canonical strings. */
const SHORT_BY_DOMAIN: ReadonlyMap<string, string> = new Map([
  ['Algebra', 'ALG'],
  ['Advanced Math', 'ADV'],
  ['Problem Solving and Data Analysis', 'PSDA'],
  ['Geometry and Trigonometry', 'GEO'],
  ['Information and Ideas', 'II'],
  ['Craft and Structure', 'CS'],
  ['Expression of Ideas', 'EOI'],
  ['Standard English Conventions', 'SEC'],
]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type BlockMix = Record<string, number> | null;
type SerializedBlock = [string, BlockMix, number, string];
type SerializedPlan = Record<string, SerializedBlock[]>;

type ParityCase = {
  name: string;
  snapshot: Record<string, JsonValue>;
  deterministic_v1: SerializedPlan;
  fallback_v1: SerializedPlan;
  deterministic_v1_explanations: Record<string, Record<string, string>>;
  stored?: { deterministic_v1: SerializedPlan; fallback_v1: SerializedPlan };
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
type ParityRow = { idx: string; det: Plan; fb: Plan; vdet: ValidatorResult; vfb: ValidatorResult };

/**
 * The oracle must be one artifact. If docs/Spec/ carries a reader copy, it has
 * to be byte-identical to the file CI actually executes — otherwise the
 * canonical corpus and the gate can disagree about what the formula is, and the
 * corpus is the one that wins arguments.
 *
 * Absent copies are fine: this asserts identity where a copy exists, it does not
 * require one.
 */
const ORACLE_COPIES: ReadonlyArray<readonly [string, string]> = [
  ['docs/Spec/calendar_formula_reference.py', 'scripts/ci/reference/calendar_formula_reference.py'],
  ['docs/Spec/calendar_formula_fixtures.json', 'scripts/ci/fixtures/calendar_formula_fixtures.json'],
];

const failures: string[] = [];
let comparisons = 0;

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
            const short = SHORT_BY_DOMAIN.get(e.domain);
            if (short === undefined) throw new Error(`unknown canonical domain ${e.domain}`);
            mix[short] = e.count;
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

/** The oracle's fifth tuple element: per-domain explanation keys, by "date#index". */
function projectExplanations(plan: Plan): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const day of plan.days) {
    day.blocks.forEach((b, i) => {
      if (b.block_type !== 'practice' || b.scope.level !== 'domain') return;
      const m: Record<string, string> = {};
      for (const e of b.scope.mix ?? []) {
        const short = SHORT_BY_DOMAIN.get(e.domain);
        if (short === undefined) throw new Error(`unknown canonical domain ${e.domain}`);
        m[short] = e.explanation_key;
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

function checkOracleCopies(): void {
  const before = failures.length;
  let checked = 0;
  for (const [specPath, ciPath] of ORACLE_COPIES) {
    const spec = path.join(ROOT, specPath);
    const ci = path.join(ROOT, ciPath);
    if (!existsSync(spec)) continue;
    if (!existsSync(ci)) {
      fail(`${ciPath} is missing, but ${specPath} exists — CI has no oracle to run`);
      continue;
    }
    checked += 1;
    if (!readFileSync(spec).equals(readFileSync(ci))) {
      fail(
        `${specPath} and ${ciPath} have diverged. The oracle must be one artifact; ` +
          `docs/Spec is the canonical corpus and is read-only to Claude Code, so this one is the owner's to reconcile.`,
      );
    }
  }
  const added = failures.length - before;
  console.log(
    added > 0
      ? `    FAIL ${added} docs/Spec reader copy/copies have diverged from the files CI runs`
      : checked === 0
        ? '    OK no docs/Spec reader copy of the oracle to cross-check'
        : `    OK ${checked} docs/Spec reader copy/copies are byte-identical to the files CI runs`,
  );
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

async function runCases(client: PgClient, label: string, cases: ParityCase[]): Promise<void> {
  const before = failures.length;
  for (let off = 0; off < cases.length; off += BATCH) {
    const part = cases.slice(off, off + BATCH);
    const { rows } = await client.query<ParityRow>(
      `SELECT t.idx::text AS idx, p.det AS det, p.fb AS fb, v.vdet AS vdet, v.vfb AS vfb
         FROM (SELECT s, idx,
                      ARRAY(SELECT jsonb_array_elements_text(s -> 'enabled_block_types')) AS enabled
                 FROM unnest($1::jsonb[]) WITH ORDINALITY AS u(s, idx)) t,
         LATERAL (SELECT public.calendar_compute_plan(t.s) AS det,
                         public.calendar_compute_plan_fallback(t.s) AS fb) p,
         LATERAL (SELECT public.calendar_validate_plan('generated', t.s,
                           public.calendar_plan_to_output(p.det, 'parity', t.enabled)) AS vdet,
                         public.calendar_validate_plan('generated', t.s,
                           public.calendar_plan_to_output(p.fb, 'parity', t.enabled)) AS vfb) v
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

    console.log('==> the oracle exists in exactly one state');
    checkOracleCopies();

    console.log('==> calendar_runtime_config vs the oracle constants');
    await checkConstants(client);

    console.log('==> nine committed fixtures');
    await runCases(client, 'fixtures', emitCases(['fixtures']));

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
  const expected = (9 + suiteN) * 2;
  if (comparisons !== expected) {
    console.error(`\nFAIL: compared ${comparisons} plans, expected ${expected} — the gate did not run what it claims to run`);
    process.exit(1);
  }
  console.log(`\nOK: ${comparisons} plan comparisons, byte-exact against the oracle`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
