/**
 * Notation-token extractor — Phase 1 of the corpus shape-diff.
 *
 * Pure function: tokens(text) -> Set<TokenName>
 * Fixed, versioned vocabulary. Each token ships with positive + negative
 * fixtures and must pass them before merge.
 *
 * @spec Corpus shape-diff Phase 1 (Karl, 2026-10-18)
 * @implemented 2026-10-18
 */

export const TOKEN_VERSION = 1;

export type TokenName =
  | "nested_function_call"
  | "composition_operator"
  | "matrix"
  | "piecewise"
  | "logarithm"
  | "trig"
  | "summation"
  | "radical";

type TokenDef = {
  name: TokenName;
  test: (text: string) => boolean;
};

function testNestedFunctionCall(text: string): boolean {
  return /[fgh]\s*\(\s*[fgh]\s*\(/.test(text);
}

function testCompositionOperator(text: string): boolean {
  // Strip degree symbols (^\circ) before checking for \circ
  const stripped = text.replace(/\^\\circ/g, "");
  return /\\circ/.test(stripped);
}

function testMatrix(text: string): boolean {
  return /\\begin\{[bp]?matrix\}/.test(text);
}

function testPiecewise(text: string): boolean {
  return /\\begin\{cases\}/.test(text);
}

function testLogarithm(text: string): boolean {
  // \log or \ln as word boundary — must not match "along", "\lnot"
  return /\\log(?![a-zA-Z])|\\ln(?![a-zA-Z])/.test(text);
}

function testTrig(text: string): boolean {
  return /\\(?:sin|cos|tan|csc|sec|cot)(?![a-zA-Z])/.test(text);
}

function testSummation(text: string): boolean {
  return /\\sum(?![a-zA-Z])|\\prod(?![a-zA-Z])/.test(text);
}

function testRadical(text: string): boolean {
  return /\\sqrt/.test(text);
}

const TOKEN_DEFS: readonly TokenDef[] = [
  { name: "nested_function_call", test: testNestedFunctionCall },
  { name: "composition_operator", test: testCompositionOperator },
  { name: "matrix", test: testMatrix },
  { name: "piecewise", test: testPiecewise },
  { name: "logarithm", test: testLogarithm },
  { name: "trig", test: testTrig },
  { name: "summation", test: testSummation },
  { name: "radical", test: testRadical },
] as const;

/**
 * Extract the set of notation tokens present in a math-bearing text field.
 * Runs all token detectors against the input and returns matching token names.
 */
export function tokens(text: string): Set<TokenName> {
  const found = new Set<TokenName>();
  for (const def of TOKEN_DEFS) {
    if (def.test(text)) {
      found.add(def.name);
    }
  }
  return found;
}

/**
 * Extract tokens from a question record's math-bearing fields
 * (stem + option texts). Returns the union of all tokens found.
 */
export function questionTokens(rec: {
  stem?: string | null;
  options?: Array<{ text?: string }> | null;
}): Set<TokenName> {
  const all = new Set<TokenName>();

  if (rec.stem) {
    for (const t of tokens(rec.stem)) all.add(t);
  }

  if (Array.isArray(rec.options)) {
    for (const opt of rec.options) {
      if (opt?.text) {
        for (const t of tokens(opt.text)) all.add(t);
      }
    }
  }

  return all;
}

// ── Fixtures (exported for test harness) ─────────────────────────────

export type Fixture = {
  token: TokenName;
  positive: string[];
  negative: string[];
};

export const FIXTURES: readonly Fixture[] = [
  {
    token: "nested_function_call",
    positive: [
      "f(g(2))",
      "h(h(2))",
      "g(f(t))-",
      "$f(g(-3))$",
      "If $f(g(x)) = 2x + 1$",
    ],
    negative: [
      "f(x+5)",
      "f(2x)",
      "f(3)",
      "P(A)",
      "f(x) = g(x)",
      "g(x) = f(x+5)",
      "f(x-1)",
      "f(x) + g(x)",
    ],
  },
  {
    token: "composition_operator",
    positive: [
      "$(f \\circ g)(x)$",
      "$(g \\circ f)(3)$",
      "the composition $f \\circ g$",
    ],
    negative: [
      "$45^\\circ$",
      "$90^\\circ$",
      "an angle of $30^\\circ$",
      "$\\triangle ABC$ with $60^\\circ$",
    ],
  },
  {
    token: "matrix",
    positive: [
      "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}",
      "\\begin{matrix} a & b \\end{matrix}",
      "\\begin{pmatrix} x \\\\ y \\end{pmatrix}",
    ],
    negative: [
      "\\begin{cases} x > 0 \\\\ x \\leq 0 \\end{cases}",
      "\\begin{aligned} 2x &= 4 \\end{aligned}",
    ],
  },
  {
    token: "piecewise",
    positive: [
      "f(x) = \\begin{cases} x^2 & x > 0 \\\\ -x & x \\leq 0 \\end{cases}",
    ],
    negative: [
      "\\begin{aligned} 2x &= 4 \\end{aligned}",
      "\\begin{bmatrix} 1 \\end{bmatrix}",
    ],
  },
  {
    token: "logarithm",
    positive: [
      "$\\log_2(x)$",
      "$\\ln x$",
      "$\\log(100)$",
      "If $\\log_b(x) = 3$",
    ],
    negative: ["along the path", "\\lnot P", "catalog", "dialogue"],
  },
  {
    token: "trig",
    positive: [
      "$\\sin(\\theta)$",
      "$\\cos(x)$",
      "$\\tan^{-1}(x)$",
      "$\\csc(x)$",
      "$\\sec(\\theta)$",
      "$\\cot(x)$",
    ],
    negative: [
      "since the value",
      "the cost of",
      "tangible results",
      "cotton fabric",
    ],
  },
  {
    token: "summation",
    positive: ["$\\sum_{i=1}^{n} i$", "$\\prod_{k=1}^{5} k$"],
    negative: ["the sum of", "a product of", "summary"],
  },
  {
    token: "radical",
    positive: ["$\\sqrt{x}$", "$\\sqrt[3]{27}$", "$\\sqrt{x^2 + y^2}$"],
    negative: ["a radical change", "radically different"],
  },
] as const;
