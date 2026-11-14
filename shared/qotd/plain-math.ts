/**
 * Question text with $...$ maths written as plain text, for places that cannot render LaTeX
 * (a Slack message, a TikTok "Why" line).
 *
 * @spec [owner brief "QOTD Slack post — add yesterday's reveal" (Karl, 2026-10-15): "the worked
 *       explanation (plain text, math readable)"; "today's question as plain text for the post
 *       body"] | @implemented [2026-10-15]
 *
 * plain English: `$\frac{a}{b}$` becomes "(a)/(b)", `x^{2}` becomes "x^2", `\sqrt{x}` becomes
 * "√(x)", `\le` becomes "≤". Total: an unknown command is written as its name, so nothing throws
 * and nothing is silently dropped. Used by the leak check (social.ts), the TikTok carousel
 * (tiktok.ts) and the worked examples, so all read the maths the same way. It was written for the
 * Reddit reveal and post (reveal.ts), which are discontinued (Karl's ruling 2026-10-30: the Reddit
 * QOTD is off) and no longer called. Not the alt text's spoken form (speakMixedText), which reads
 * maths aloud for a screen reader.
 */
import { tokenizeMathContent } from "../math/tokenize";

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
function latexToPlain(latex: string): string {
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
        out += arg === "°" ? "°" : `${ch}${grouped(arg)}`;
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
};

/**
 * Mixed text and $...$ maths as plain text; `<u>` tags and blanks written for a reader.
 *
 * @spec [Karl's fix 2026-11-14 ("separate equations show on separate lines")] (displayOnOwnLine)
 *       | @implemented [2026-10-15, displayOnOwnLine 2026-11-14]
 */
export function plainMathText(
  content: string,
  options: PlainMathOptions = {},
): string {
  const ownLine = options.displayOnOwnLine === true;
  let out = "";
  for (const token of tokenizeMathContent(content)) {
    if (token.type === "text") {
      out += token.content
        .replace(/\\\$/g, "$")
        .replace(/<\/?u>/g, "")
        .replace(/_{2,}/g, "____");
    } else if (ownLine && token.displayMode) {
      out += `\n${latexToPlain(token.content)}\n`;
    } else {
      out += latexToPlain(token.content);
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
