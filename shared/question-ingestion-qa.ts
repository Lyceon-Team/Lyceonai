/**
 * Question Ingestion QA — the pure validator (the moat).
 *
 * @spec [Doc-02A_V6, §10/§14/§15/§16/§18/§23] | @spec [Doc 02 Preamble §12 INV-02-08/09]
 * @spec [Doc-04A §7.3.1 / Doc-04B V4.3 — student-produced response]
 * @implemented 2026-06-14
 *
 * plain English: a deterministic, side-effect-free gate that turns a single staged
 * ingestion candidate (one real College Board question, pre-canonical-id) into a
 * verdict { pass | reject | flag, reasons[], advisory_flags[] }. It encodes §23's
 * blocking gates AND the 280-discard defect taxonomy as falsifiable assertions, so
 * slop is structurally rejectable. IO-bound gates (exact/near dedup, KaTeX-strict
 * render, asset resolve+sha256) are computed elsewhere and folded in via `context`
 * — the verdict stays a pure function of (candidate, context).
 *
 * It does NOT mint canonical ids (§14: product-side, at promotion) and it does NOT
 * decide answer correctness (owner-eye) — only structural consistency. Reuses the
 * canonical normalizers from ./question-bank-contract (single source of truth; no fork).
 */

import { z } from "zod";
import {
  MC_OPTION_KEYS,
  normalizeSectionCode,
  normalizeAnswerKey,
  parseCanonicalMcOptions,
  type CanonicalOptionKey,
} from "./question-bank-contract";

// ---------------------------------------------------------------------------
// Result types (discriminated by `status`, Coding Standards §3.5)
// ---------------------------------------------------------------------------

export type QaReasonCode =
  | "QA-SCHEMA"
  | "QA-SOURCE"
  | "QA-SECTION"
  | "QA-DIFF"
  | "QA-ITEMTYPE"
  | "QA-META"
  | "QA-STEM"
  | "QA-EXPL-LEN"
  | "QA-OPT-COUNT"
  | "QA-OPT-DUP"
  | "QA-KEY"
  | "QA-ONE-CORRECT"
  | "QA-TAXONOMY"
  | "QA-GRID-SHAPE"
  | "QA-GRID-VARIANTS"
  | "QA-RW-PASSAGE"
  | "QA-MATH-RENDER"
  | "QA-ASSET-REF"
  | "QA-ASSET-IP"
  | "QA-ASSET-FAITHFUL"
  | "QA-ASSET-RESOLVE"
  | "QA-DUP-EXACT"
  | "QA-DUP-NEAR";

export type QaReason = { code: QaReasonCode; message: string };

export type IngestionQaResult =
  | {
      status: "pass";
      reasons: [];
      advisory_flags: string[];
      fingerprint: string;
    }
  | {
      status: "reject";
      reasons: QaReason[];
      advisory_flags: string[];
      fingerprint: string;
    }
  | {
      status: "flag";
      reasons: QaReason[];
      advisory_flags: string[];
      fingerprint: string;
    };

/**
 * Results of the IO-bound probes the pipeline runs around this pure function.
 * Absent fields mean "probe not yet run" → emitted as advisory, never a silent pass.
 */
export type IngestionQaContext = {
  /** exact-duplicate hit against live bank or current staging batch (§23, 280 #3). */
  exactDuplicateOf?: string | null;
  /** near-duplicate hit (embedding similarity ≥ 0.95) → route to dedup (§23/§24, 280 #4). */
  nearDuplicateOf?: string | null;
  /** per-span KaTeX-strict parse results for the math spans this candidate carries. */
  mathRender?: ReadonlyArray<{ span: string; ok: boolean }>;
  /** per-asset resolve (HEAD 200) + sha256 match results (§23 "no broken assets"). */
  assetResolution?: ReadonlyArray<{
    id: string;
    resolved: boolean;
    sha256Match: boolean;
  }>;
};

// ---------------------------------------------------------------------------
// Candidate schema (QA-SCHEMA) — single source of truth for an ingestion candidate.
// Grounded in the real CB source: stem/options/answer-key/rationale + provenance.
// ---------------------------------------------------------------------------

// Figures resolve as OWNER-AUTHORED artwork only (HALT-2 ruling = path (a)).
// A figure is geometry, not text: a vision model reads the original CB figure's
// content and the owner REGENERATES it as a fresh SVG (or an owner-authored data
// table). The regenerated artwork is the owner's IP; CB's raster never ships.
//   - Path (a) — owner-regenerated SVG / owner-authored table → IP-clean, promotable.
//   - Path (b) — crop CB's raster + OCR-index it → still ships CB artwork; the OCR
//     costume does NOT clear the IP. There is intentionally NO asset kind for a
//     captured raster, so (b) is structurally unrepresentable here.
const ASSET_KINDS = ["svg", "table"] as const;
const ASSET_PROVENANCE = [
  "owner-regenerated-svg",
  "owner-authored-table",
] as const;

const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  provenance: z.enum(ASSET_PROVENANCE),
  // The CB figure this was regenerated from — the reference the owner-eye compares
  // the regenerated SVG against. Provenance + source_ref make faithfulness auditable.
  source_ref: z.string().min(1),
  // Owner-eye sign-off that the regenerated figure FAITHFULLY matches the original.
  // The machine verifies render + resolve; only the owner verifies faithfulness, and
  // a figure cannot promote until this is true (vision-extraction is the highest-error
  // step in the pipeline — a misread coordinate is a wrong figure that looks right).
  faithfulness_verified: z.boolean(),
  uri: z.string().min(1),
  alt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const optionSchema = z.object({
  key: z.enum(MC_OPTION_KEYS),
  text: z.string(),
});

const sourceLineageSchema = z.object({
  provenance: z.literal("College Board official"),
  cb_question_id: z.string().min(1), // e.g. "fa80893a" printed on each item
  source_filename: z.string().min(1), // the <Difficulty> - <Skill> - <Domain> - <Section> file
  source_page: z.number().int().positive().nullable(),
  extracted_at: z.string().min(1),
  extractor_version: z.string().min(1),
});

export const ingestionCandidateSchema = z.object({
  staging_id: z.string().uuid(), // tracking only; canonical id is minted at promotion (§14)
  item_type: z.enum(["mcq", "grid_in"]),
  section: z.string(),
  source_type: z.number().int(),
  domain: z.string(),
  skill_codes: z.array(z.string()),
  difficulty: z.number().int(),
  stem: z.string(),
  passage: z.string().nullable().optional(),
  options: z.array(optionSchema).nullable().optional(),
  correct_answer: z.string().nullable().optional(),
  correct_variants: z.array(z.string()).nullable().optional(),
  explanation: z.string(),
  option_metadata: z.unknown().optional(),
  assets: z.array(assetSchema).nullable().optional(),
  estimated_time_seconds: z.number().int().positive().nullable().optional(),
  source_lineage: sourceLineageSchema,
});

export type IngestionCandidate = z.infer<typeof ingestionCandidateSchema>;

// Wave constant: this ingestion wave is official CB content only.
const WAVE_SOURCE_TYPE = 1;
const MIN_EXPLANATION_CHARS = 20; // §23 "Explanation present"
const MIN_RW_PASSAGE_CHARS = 40; // floor; truncation heuristic below is advisory

// ---------------------------------------------------------------------------
// Grid-in response normalizer (HALT-5). The most-scrutinized piece.
//
// Grounded in the College Board Digital SAT student-produced-response (SPR) rules,
// as reflected verbatim in the source rationales (e.g. CB item 2f0a43b2:
// "Note that 1/5 and .2 are examples of ways to enter a correct answer"):
//   - answers may be entered as a fraction OR a decimal (or a whole number);
//   - .2, 0.2, 0.20, 1/5 are all the same value (leading-zero / trailing-zero
//     / fraction-vs-decimal equivalence);
//   - negative values are allowed;
//   - mixed numbers are NOT allowed (e.g. "3 1/2" must be "7/2" or "3.5");
//   - percent signs, commas, currency, and spaces are not valid grid entries.
// We do NOT invent equivalence — we model exact rational equality, which is what
// CB's "examples of ways to enter" enumerates. Repeating-decimal grid-fill
// tolerance (e.g. 2/3 → ".666" / ".667") is the ONE runtime concern owned by the
// 04B scoring path, not by this ingestion-time key check — see normalizeGridInKey.
// ---------------------------------------------------------------------------

type Rational = { num: bigint; den: bigint }; // den > 0, reduced

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

function makeRational(num: bigint, den: bigint): Rational | null {
  if (den === 0n) return null;
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { num: n / g, den: d / g };
}

/**
 * Parse a single grid-in surface form into an exact reduced rational, or null if
 * the form is not a valid CB SPR entry. Accepts integers, decimals (incl. ".2",
 * "0.20"), and proper/improper fractions "a/b", each optionally signed.
 * Rejects: mixed numbers, percents, exponents, thousands separators, blanks.
 */
export function parseGridInValue(raw: string): Rational | null {
  const s = raw.trim();
  if (!s) return null;

  // Fraction "a/b" (each part an optionally-signed integer; no nested decimals).
  const frac = /^([+-]?\d+)\/([+-]?\d+)$/.exec(s);
  if (frac) {
    const n = BigInt(frac[1]);
    const d = BigInt(frac[2]);
    return makeRational(n, d);
  }

  // Decimal or integer: optional sign, digits, optional single dot, digits.
  // Permits ".2" and "2." and "0.50"; forbids multiple dots / separators / signs.
  const dec = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!dec) return null;
  const sign = dec[1] === "-" ? -1n : 1n;
  const intPart = dec[2] ?? "";
  const fracPart = dec[3] ?? "";
  if (intPart === "" && fracPart === "") return null; // bare sign or dot
  const digits = `${intPart}${fracPart}` || "0";
  const num = sign * BigInt(digits);
  const den = 10n ** BigInt(fracPart.length);
  return makeRational(num, den);
}

export function gridInEquivalent(a: string, b: string): boolean {
  const ra = parseGridInValue(a);
  const rb = parseGridInValue(b);
  if (!ra || !rb) return false;
  return ra.num === rb.num && ra.den === rb.den;
}

export type GridInKey =
  | { ok: true; rationalNum: string; rationalDen: string; variants: string[] }
  | { ok: false; error: string };

/**
 * Validate + canonicalize a source grid-in answer key. The source stores the
 * accepted forms as a list (e.g. "0.2, 1/5" → ["0.2","1/5"]); every form must
 * parse and all must be the SAME rational, else the key is internally inconsistent
 * (a real 280-class defect) and the item is rejected.
 *
 * Runtime equivalence-checking of a STUDENT response against this key (including
 * repeating-decimal grid-fill rounding/truncation) is owned by Doc 04B scoring,
 * which already matches against a `correct_variants` array — this function produces
 * exactly that array plus the exact rational so 04B never has to re-parse.
 */
export function normalizeGridInKey(rawVariants: readonly string[]): GridInKey {
  const variants = rawVariants.map((v) => v.trim()).filter((v) => v.length > 0);
  if (variants.length === 0)
    return { ok: false, error: "grid-in key has no accepted forms" };

  const first = parseGridInValue(variants[0]);
  if (!first)
    return { ok: false, error: `unparseable grid-in form: ${variants[0]}` };

  for (const v of variants) {
    const r = parseGridInValue(v);
    if (!r) return { ok: false, error: `unparseable grid-in form: ${v}` };
    if (r.num !== first.num || r.den !== first.den) {
      return {
        ok: false,
        error: `inconsistent grid-in forms: ${variants.join(", ")}`,
      };
    }
  }
  return {
    ok: true,
    rationalNum: first.num.toString(),
    rationalDen: first.den.toString(),
    variants,
  };
}

// ---------------------------------------------------------------------------
// Helpers (intrinsic, pure)
// ---------------------------------------------------------------------------

function normalizeForFingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Deterministic content fingerprint for exact-dup detection (caller compares). */
export function fingerprintCandidate(candidate: IngestionCandidate): string {
  const opts = parseCanonicalMcOptions(candidate.options ?? null)
    .map((o) => `${o.key}:${normalizeForFingerprint(o.text)}`)
    .join("|");
  const variants = (candidate.correct_variants ?? [])
    .map((v) => v.trim())
    .sort()
    .join(",");
  const parts = [
    candidate.section,
    candidate.item_type,
    normalizeForFingerprint(candidate.stem),
    normalizeForFingerprint(candidate.passage ?? ""),
    opts,
    variants,
  ];
  return parts.join("␟");
}

const ASSET_REF = /\{\{asset:([A-Za-z0-9_-]+)\}\}/g;
const MATH_SPAN = /\$\$?([^$]+?)\$\$?/g;

function collectAssetRefs(candidate: IngestionCandidate): string[] {
  const haystacks = [
    candidate.stem,
    candidate.passage ?? "",
    ...parseCanonicalMcOptions(candidate.options ?? null).map((o) => o.text),
  ];
  const ids = new Set<string>();
  for (const h of haystacks) {
    for (const m of h.matchAll(ASSET_REF)) ids.add(m[1]);
  }
  return [...ids];
}

export function extractMathSpans(candidate: IngestionCandidate): string[] {
  const haystacks = [
    candidate.stem,
    candidate.passage ?? "",
    ...parseCanonicalMcOptions(candidate.options ?? null).map((o) => o.text),
  ];
  const spans: string[] = [];
  for (const h of haystacks) {
    for (const m of h.matchAll(MATH_SPAN)) spans.push(m[1]);
  }
  return spans;
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export function evaluateIngestionCandidate(
  input: unknown,
  context: IngestionQaContext = {},
): IngestionQaResult {
  const reasons: QaReason[] = [];
  const advisory: string[] = [];

  const parsed = ingestionCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "reject",
      reasons: [
        {
          code: "QA-SCHEMA",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      ],
      advisory_flags: advisory,
      fingerprint: "",
    };
  }
  const c = parsed.data;
  const fingerprint = fingerprintCandidate(c);
  const flags: QaReason[] = [];
  const reject = (code: QaReasonCode, message: string): void => {
    reasons.push({ code, message });
  };
  // route-to-owner (not a defect): needs a human step before promotion.
  const flag = (code: QaReasonCode, message: string): void => {
    flags.push({ code, message });
  };

  // --- shared gates (both item types) ---
  if (c.source_type !== WAVE_SOURCE_TYPE)
    reject(
      "QA-SOURCE",
      `source_type must be ${WAVE_SOURCE_TYPE} (official CB) for this wave; got ${c.source_type}`,
    );
  const section = normalizeSectionCode(c.section);
  if (!section)
    reject(
      "QA-SECTION",
      `section must normalize to M or RW; got '${c.section}'`,
    );
  if (![1, 2, 3].includes(c.difficulty))
    reject("QA-DIFF", `difficulty must be 1|2|3; got ${c.difficulty}`);
  if (!c.domain.trim()) reject("QA-META", "domain is required");
  if (c.skill_codes.length === 0 || c.skill_codes.some((s) => !s.trim()))
    reject(
      "QA-META",
      "skill_codes must be a non-empty array of non-empty codes",
    );
  if (!c.stem.trim()) reject("QA-STEM", "stem is required");
  if (c.explanation.trim().length < MIN_EXPLANATION_CHARS)
    reject(
      "QA-EXPL-LEN",
      `explanation must be ≥ ${MIN_EXPLANATION_CHARS} chars`,
    );

  // --- item-type-specific ---
  if (c.item_type === "mcq") {
    const opts = parseCanonicalMcOptions(c.options ?? null);
    if (opts.length !== 4 || new Set(opts.map((o) => o.key)).size !== 4) {
      reject(
        "QA-OPT-COUNT",
        "mcq must have exactly 4 options keyed A/B/C/D, all non-empty",
      );
    } else {
      const texts = opts.map((o) => normalizeForFingerprint(o.text));
      if (new Set(texts).size !== texts.length)
        reject(
          "QA-OPT-DUP",
          "option texts must be distinct after normalization (280 #1)",
        );
    }
    const key: CanonicalOptionKey | null = normalizeAnswerKey(c.correct_answer);
    if (!key) reject("QA-KEY", "correct_answer must be one of A/B/C/D for mcq");
    else if (!opts.some((o) => o.key === key))
      reject("QA-KEY", `correct_answer '${key}' is not among the option keys`);
    if (c.correct_variants && c.correct_variants.length > 0)
      reject("QA-GRID-SHAPE", "mcq must not carry correct_variants");
    // option_metadata is optional for source-derived content; if present, it must be consistent.
    const meta = c.option_metadata;
    if (meta && typeof meta === "object") {
      const roles = Object.values(meta as Record<string, unknown>).filter(
        (v): v is { role?: unknown } => !!v && typeof v === "object",
      );
      const corrects = roles.filter(
        (r) => (r as { role?: unknown }).role === "correct",
      );
      if (roles.length > 0 && corrects.length !== 1)
        reject(
          "QA-ONE-CORRECT",
          "option_metadata, when present, must mark exactly one role:correct",
        );
    }
  } else {
    // grid_in. genesis `correct_answer` is NOT NULL, so it holds the canonical
    // primary form (e.g. "0.2"); `correct_variants` holds the full accepted set
    // (must include the primary, and all must be the same value).
    const opts = parseCanonicalMcOptions(c.options ?? null);
    if (opts.length > 0)
      reject("QA-GRID-SHAPE", "grid_in must not carry options");
    const primary = (c.correct_answer ?? "").trim();
    if (!primary)
      reject(
        "QA-GRID-SHAPE",
        "grid_in must carry a canonical correct_answer value",
      );
    else if (normalizeAnswerKey(primary))
      reject(
        "QA-GRID-SHAPE",
        "grid_in correct_answer must be a value, not an A/B/C/D key",
      );
    if (!c.correct_variants || c.correct_variants.length === 0) {
      reject(
        "QA-GRID-VARIANTS",
        "grid_in must carry a non-empty correct_variants set",
      );
    } else {
      if (primary && !c.correct_variants.some((v) => v.trim() === primary))
        reject(
          "QA-GRID-VARIANTS",
          "correct_answer must be one of correct_variants",
        );
      const key = normalizeGridInKey(
        primary ? [primary, ...c.correct_variants] : c.correct_variants,
      );
      if (!key.ok) reject("QA-GRID-VARIANTS", key.error);
    }
  }

  // --- RW passage integrity (280 #5: truncated / missing passages) ---
  if (section === "RW") {
    const passage = (c.passage ?? "").trim();
    if (!passage) {
      reject("QA-RW-PASSAGE", "RW item must carry a passage");
    } else if (passage.length < MIN_RW_PASSAGE_CHARS) {
      reject(
        "QA-RW-PASSAGE",
        `RW passage below floor (${MIN_RW_PASSAGE_CHARS} chars)`,
      );
    } else if (!/[.!?"'’”)\]]$/.test(passage)) {
      // heuristic: a passage that does not end on terminal punctuation may be truncated.
      advisory.push(
        "QA-RW-PASSAGE: passage does not end on terminal punctuation (possible truncation — owner-eye)",
      );
    }
  }

  // --- math render (KaTeX strict). Intrinsic: delimiters balanced. IO: parse ok. ---
  const spans = extractMathSpans(c);
  const dollarCount = (c.stem.match(/\$/g) ?? []).length;
  if (dollarCount % 2 !== 0)
    reject("QA-MATH-RENDER", "unbalanced '$' math delimiters in stem");
  if (context.mathRender) {
    for (const r of context.mathRender)
      if (!r.ok)
        reject("QA-MATH-RENDER", `math span fails KaTeX-strict: ${r.span}`);
  } else if (spans.length > 0) {
    advisory.push(
      `QA-MATH-RENDER: ${spans.length} math span(s) pending KaTeX-strict render probe`,
    );
  }

  // --- asset references (intrinsic dangling) + resolution (IO) ---
  const refIds = collectAssetRefs(c);
  const assetIds = new Set((c.assets ?? []).map((a) => a.id));
  for (const ref of refIds)
    if (!assetIds.has(ref))
      reject(
        "QA-ASSET-REF",
        `dangling asset ref {{asset:${ref}}} has no matching assets[] entry`,
      );
  for (const a of c.assets ?? []) {
    if (/^data:/i.test(a.uri))
      reject(
        "QA-ASSET-REF",
        `asset ${a.id} uses inline base64; storage URI required`,
      );
    // QA-ASSET-IP: kind ↔ provenance must agree (HALT-2 path (a)). A captured CB
    // raster has no representable kind; an inconsistent pair is rejected.
    const ipOk =
      (a.kind === "svg" && a.provenance === "owner-regenerated-svg") ||
      (a.kind === "table" && a.provenance === "owner-authored-table");
    if (!ipOk)
      reject(
        "QA-ASSET-IP",
        `asset ${a.id}: kind '${a.kind}' / provenance '${a.provenance}' is not an owner-authored figure (no CB raster capture)`,
      );
    // QA-ASSET-FAITHFUL: owner-eye faithfulness is non-skippable; until verified the
    // item is routed to the owner (flag), never auto-promoted.
    if (!a.faithfulness_verified)
      flag(
        "QA-ASSET-FAITHFUL",
        `asset ${a.id}: regenerated figure pending owner-eye faithfulness verification vs ${a.source_ref}`,
      );
  }
  if (context.assetResolution) {
    for (const r of context.assetResolution) {
      if (!r.resolved)
        reject(
          "QA-ASSET-RESOLVE",
          `asset ${r.id} did not resolve (HEAD != 200)`,
        );
      else if (!r.sha256Match)
        reject("QA-ASSET-RESOLVE", `asset ${r.id} sha256 mismatch`);
    }
  } else if ((c.assets ?? []).length > 0) {
    advisory.push(
      `QA-ASSET-RESOLVE: ${(c.assets ?? []).length} asset(s) pending resolve+sha256 probe`,
    );
  }

  // --- duplicate detection (IO, folded in) ---
  if (context.exactDuplicateOf)
    reject(
      "QA-DUP-EXACT",
      `exact duplicate of ${context.exactDuplicateOf} (280 #3)`,
    );
  if (context.nearDuplicateOf) {
    // near-dup is a route-to-review, not a hard reject (§23 → dedup queue).
    flag(
      "QA-DUP-NEAR",
      `near-duplicate of ${context.nearDuplicateOf} (≥0.95) — route to dedup`,
    );
  }

  // Verdict precedence: a defect (reject) outranks a route-to-owner (flag).
  if (reasons.length > 0)
    return { status: "reject", reasons, advisory_flags: advisory, fingerprint };
  if (flags.length > 0)
    return {
      status: "flag",
      reasons: flags,
      advisory_flags: advisory,
      fingerprint,
    };
  return { status: "pass", reasons: [], advisory_flags: advisory, fingerprint };
}
