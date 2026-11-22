/**
 * Question text with $...$ maths written as plain text, for places that cannot render LaTeX
 * (a Slack message, a TikTok "Why" line).
 *
 * @spec [owner brief "QOTD Slack post — add yesterday's reveal" (Karl, 2026-10-15): "the worked
 *       explanation (plain text, math readable)"; "today's question as plain text for the post
 *       body"] | @implemented [2026-10-15]
 *
 * plain English: `$\frac{a}{b}$` becomes "(a)/(b)", `x^{2}` becomes "x²", `\sqrt{x}` becomes
 * "√(x)", `\le` becomes "≤". A power is written in Unicode superscripts where every character of
 * it has one (x², x³, 2ⁿ, x⁻¹, 10⁻³; Karl, 2026-11-16: "I want it to read like maths"), and as
 * ^(…) otherwise (x^(k+1): there is no superscript k). `{ superscripts: false }` gives the form
 * before that ruling ("x^2"), which the leak checks still match (social.ts). Total: an unknown command is written as its name, so nothing throws
 * and nothing is silently dropped. Used by the leak check (social.ts), the TikTok carousel
 * (tiktok.ts) and the worked examples, so all read the maths the same way. It was written for the
 * Reddit reveal and post (reveal.ts), which are discontinued (Karl's ruling 2026-10-30: the Reddit
 * QOTD is off) and no longer called. Not the alt text's spoken form (speakMixedText), which reads
 * maths aloud for a screen reader.
 */
import { tokenizeMathContent } from "../math/tokenize";

/**
 * The characters a power may be written in as Unicode superscripts: the digits, the signs and
 * brackets, and n and i (the two letters every common font draws). Anything else in a power
 * falls back to ^(…). Karl, 2026-11-16: "use Unicode superscripts for powers (x², x³, 2ⁿ, x⁻¹);
 * fall back to ^(…) only where no superscript exists".
 */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

/** The power in superscripts, or null when one of its characters has none. */
function toSuperscript(power: string): string | null {
  const chars = [...power.replace(/\s+/g, "")];
  if (chars.length === 0) return null;
  let out = "";
  for (const ch of chars) {
    const sup = SUPERSCRIPT[ch];
    if (sup === undefined) return null;
    out += sup;
  }
  return out;
}

const SYMBOLS: Record<string, string> = {
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  pi: "π",
  theta: "θ",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  lambda: "λ",
  mu: "μ",
  sigma: "σ",
  infty: "∞",
  circ: "°",
  degree: "°",
  angle: "∠",
  triangle: "△",
  perp: "⊥",
  parallel: "∥",
  cong: "≅",
  sim: "~",
  to: "→",
  rightarrow: "→",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  "%": "%",
  $: "$",
  "{": "{",
  "}": "}",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
  " ": " ",
  quad: " ",
  qquad: " ",
  left: "",
  right: "",
};

/** A group's text, bracketed when it is more than one character, so (a+b)/(c) reads right. */
function grouped(text: string): string {
  const t = text.trim();
  return t.length <= 1 || /^[\w.]+$/.test(t) ? t : `(${t})`;
}

/**
 * LaTeX (the inside of one $...$) as plain text. Total: an unknown command is written as its
 * name, so nothing throws and nothing is silently dropped.
 */
function latexToPlain(latex: string, superscripts: boolean): string {
  let i = 0;
  const readGroup = (): string => {
    // At "{": the group's plain text; otherwise the next single token.
    while (latex[i] === " ") i += 1;
    if (latex[i] === "{") {
      i += 1;
      return sequence("}");
    }
    if (latex[i] === "\\") return command();
    const ch = latex[i] ?? "";
    i += 1;
    return ch;
  };
  const command = (): string => {
    i += 1; // the backslash
    const m = /^([A-Za-z]+|.)/.exec(latex.slice(i));
    const name = m?.[1] ?? "";
    i += name.length;
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac": {
        const num = readGroup();
        const den = readGroup();
        return `${grouped(num)}/${grouped(den)}`;
      }
      case "sqrt": {
        let index = "";
        if (latex[i] === "[") {
          const end = latex.indexOf("]", i);
          index = latex.slice(i + 1, end === -1 ? latex.length : end);
          i = end === -1 ? latex.length : end + 1;
        }
        return `${index}√${grouped(readGroup()) || "()"}`;
      }
      case "text":
      case "textrm":
      case "textit":
      case "textbf":
      case "mathrm":
      case "mathit":
      case "mathbf":
      case "operatorname":
        return readGroup();
      case "overline":
        return `${readGroup()}̅`;
      default:
        return SYMBOLS[name] ?? name;
    }
  };
  const sequence = (until: string | null): string => {
    let out = "";
    while (i < latex.length) {
      const ch = latex[i] as string;
      if (until !== null && ch === until) {
        i += 1;
        return out;
      }
      if (ch === "\\") {
        out += command();
      } else if (ch === "{") {
        i += 1;
        out += sequence("}");
      } else if (ch === "^" || ch === "_") {
        i += 1;
        const arg = readGroup();
        const sup =
          ch === "^" && superscripts && arg !== "°" ? toSuperscript(arg) : null;
        out += arg === "°" ? "°" : (sup ?? `${ch}${grouped(arg)}`);
      } else if (ch === "}") {
        i += 1; // a stray close: dropped, never fatal
      } else {
        out += ch;
        i += 1;
      }
    }
    return out;
  };
  return sequence(null)
    .replace(/\s+/g, " ")
    .replace(/\s*([=<>+≤≥≠×÷·−])\s*/g, " $1 ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

export type PlainMathOptions = {
  /**
   * Each display equation ($$...$$ or \[...\]) on a line of its own, as the app's MathRenderer
   * draws it (a KaTeX display block). Off by default, so the QOTD post, caption and leak check
   * read as before; the worked-example card turns it on, where two display equations written
   * back to back ("...have?$$y = x^2 - 4x + 5$$$$y = 2x - 3$$") otherwise ran into one line
   * (Karl, 2026-11-14, W47 SATM2GL735M).
   */
  displayOnOwnLine?: boolean;
  /**
   * Powers in Unicode superscripts (x²). On by default (Karl, 2026-11-16); false gives the
   * earlier "x^2" form, which the leak checks match alongside the new one.
   */
  superscripts?: boolean;
};

/**
 * Mixed text and $...$ maths as plain text; `<u>` tags and blanks written for a reader.
 *
 * @spec [Karl's fix 2026-11-14 ("separate equations show on separate lines")] (displayOnOwnLine);
 *       Karl, 2026-11-16 (superscripts: "plain-text places … use Unicode superscripts for powers")
 *       | @implemented [2026-10-15, displayOnOwnLine 2026-11-14, superscripts 2026-11-16]
 */
export function plainMathText(
  content: string,
  options: PlainMathOptions = {},
): string {
  const ownLine = options.displayOnOwnLine === true;
  const superscripts = options.superscripts !== false;
  let out = "";
  for (const token of tokenizeMathContent(content)) {
    if (token.type === "text") {
      out += token.content
        .replace(/\\\$/g, "$")
        .replace(/<\/?u>/g, "")
        .replace(/_{2,}/g, "____");
    } else if (ownLine && token.displayMode) {
      out += `\n${latexToPlain(token.content, superscripts)}\n`;
    } else {
      out += latexToPlain(token.content, superscripts);
    }
  }
  const flat = out
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.;:?!])/g, "$1")
    .trim();
  return ownLine
    ? flat
        .replace(/ *\n\s*/g, "\n")
        .replace(/\n([,.;:?!])/g, "$1")
        .replace(/^\n+|\n+$/g, "")
    : flat;
}
