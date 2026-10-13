/**
 * The ONE text/maths tokenizer: splits mixed text into text and LaTeX pieces.
 *
 * @spec [E7b decision log D5 (passage highlights leave maths whole); owner decisions 2026-10-07
 *       on the QOTD social assets (the alt text reads the maths out)] | @implemented [2026-09-25]
 *       | moved [2026-10-07]
 *
 * plain English: moved verbatim out of client/src/components/MathRenderer.tsx, which imports
 * the KaTeX stylesheet and so cannot be loaded by a Node script. MathRenderer, StaticMath, the
 * exam passage view and the QOTD social alt text (shared/qotd/social.ts) all split text from
 * maths with this, so they cannot disagree about where a formula starts. Pure: no DOM, no IO.
 */
/**
 * `rawStart`/`rawEnd` are the token's [start, end) in the SOURCE string (UTF-16
 * indexes, delimiters and escapes included), so a caller can map rendered pieces
 * back to offsets in the original text (the exam passage highlighter, E7b).
 */
type Token =
  | { type: "text"; content: string; rawStart: number; rawEnd: number }
  | {
      type: "math";
      content: string;
      displayMode: boolean;
      wrapper?: "dollar" | "slash";
      rawStart: number;
      rawEnd: number;
    };

export type MathContentToken = Token;

/**
 * @spec [E7b decision log D5 (passage highlights leave maths whole)] | @implemented [2026-09-25]
 * plain English: the tokenizer MathRenderer itself uses, exported so the exam passage
 * view splits text from maths exactly as MathRenderer would — one tokenizer, not two.
 */
export function tokenizeMathContent(content: string): MathContentToken[] {
  return tokenizeContent(content, false);
}

/**
 * Tokenizes content into alternating text/math tokens.
 *
 * Supports:
 * - Display math: $$...$$ (can span newlines)
 * - Inline math: $...$ (does not span newlines; stops at next unescaped $)
 * - Display math: \[...\] (can span newlines)
 * - Inline math: \( ... \) (can span newlines)
 *
 * Honors escaped dollars: \$
 * Preserves all text deterministically.
 */
export function tokenizeContent(
  content: string,
  defaultDisplayMode: boolean,
): Token[] {
  const tokens: Token[] = [];

  let i = 0;
  let textBuf = "";
  let textStart = 0;

  const flushText = () => {
    if (textBuf.length > 0) {
      tokens.push({
        type: "text",
        content: textBuf,
        rawStart: textStart,
        rawEnd: i,
      });
      textBuf = "";
    }
  };
  const appendText = (piece: string, width: number) => {
    if (textBuf.length === 0) textStart = i;
    textBuf += piece;
    i += width;
  };

  while (i < content.length) {
    const ch = content[i];

    // Handle escaped dollars \$
    if (ch === "\\" && i + 1 < content.length && content[i + 1] === "$") {
      appendText("$", 2);
      continue;
    }

    // Handle \[ ... \] (display math)
    if (ch === "\\" && i + 1 < content.length && content[i + 1] === "[") {
      const start = i + 2;
      const end = findClosingSlashBracket(content, start); // finds \]
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({
          type: "math",
          content: latex,
          displayMode: true,
          wrapper: "slash",
          rawStart: i,
          rawEnd: end + 2,
        });
        i = end + 2; // skip "\]"
        continue;
      }
      // no closing -> treat as text
      appendText("\\[", 2);
      continue;
    }

    // Handle \( ... \) (inline math)
    if (ch === "\\" && i + 1 < content.length && content[i + 1] === "(") {
      const start = i + 2;
      const end = findClosingSlashParen(content, start); // finds \)
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({
          type: "math",
          content: latex,
          displayMode: false,
          wrapper: "slash",
          rawStart: i,
          rawEnd: end + 2,
        });
        i = end + 2; // skip "\)"
        continue;
      }
      // no closing -> treat as text
      appendText("\\(", 2);
      continue;
    }

    // Display math $$...$$
    if (ch === "$" && i + 1 < content.length && content[i + 1] === "$") {
      const start = i + 2;
      const end = findClosingDoubleDollar(content, start);
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({
          type: "math",
          content: latex,
          displayMode: true,
          wrapper: "dollar",
          rawStart: i,
          rawEnd: end + 2,
        });
        i = end + 2;
        continue;
      }
      // No closing $$ -> treat as text
      appendText("$$", 2);
      continue;
    }

    // Inline math $...$
    if (ch === "$") {
      const start = i + 1;
      const end = findClosingSingleDollar(content, start);
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({
          type: "math",
          content: latex,
          displayMode: defaultDisplayMode,
          wrapper: "dollar",
          rawStart: i,
          rawEnd: end + 1,
        });
        i = end + 1;
        continue;
      }
      // No closing $ -> treat as text
      appendText("$", 1);
      continue;
    }

    // Normal character
    appendText(ch, 1);
  }

  flushText();
  if (tokens.length === 0)
    tokens.push({ type: "text", content, rawStart: 0, rawEnd: content.length });

  return tokens;
}

function findClosingDoubleDollar(s: string, fromIndex: number): number {
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === "\\" && s[i + 1] === "$") {
      i += 1;
      continue;
    }
    if (s[i] === "$" && s[i + 1] === "$") return i;
  }
  return -1;
}

function findClosingSingleDollar(s: string, fromIndex: number): number {
  for (let i = fromIndex; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && s[i + 1] === "$") {
      i += 1;
      continue;
    }
    if (s[i] === "$") return i;
  }
  return -1;
}

function findClosingSlashBracket(s: string, fromIndex: number): number {
  // Finds "\]" starting at fromIndex
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === "\\" && s[i + 1] === "]") return i;
  }
  return -1;
}

function findClosingSlashParen(s: string, fromIndex: number): number {
  // Finds "\)" starting at fromIndex
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === "\\" && s[i + 1] === ")") return i;
  }
  return -1;
}
