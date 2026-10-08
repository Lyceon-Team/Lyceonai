import { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  tokenizeContent,
  tokenizeMathContent,
  type MathContentToken,
} from '@shared/math/tokenize';

// Re-exported so existing importers keep one path; the tokenizer itself lives in shared/math.
export { tokenizeMathContent };
export type { MathContentToken };

interface MathRendererProps {
  content: string;
  className?: string;
  displayMode?: boolean; // default display mode if inline tokens don't specify
}

/**
 * MathRenderer
 * - Renders mixed plain text + LaTeX safely via DOM nodes (no innerHTML).
 * - Supports LaTeX delimiters:
 *    - $$...$$   (display)
 *    - $...$     (inline)
 *    - \[...\]   (display)
 *    - \(...\)   (inline)
 * - Enhances plain-text caret exponents OUTSIDE LaTeX:
 *    x^2 -> x<sup>2</sup>
 *    x^10 -> x<sup>10</sup>
 *    x^-2 -> x<sup>-2</sup>
 *    x^(10) -> x<sup>10</sup>
 *    x^(-2) -> x<sup>-2</sup>
 *    x^{10} -> x<sup>10</sup>
 *    x^{-2} -> x<sup>-2</sup>
 */
export function MathRenderer({
  content,
  className = '',
  displayMode = false,
}: MathRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);

    const el = containerRef.current;
    if (!el) {
      setIsLoading(false);
      return;
    }

    if (!content) {
      el.replaceChildren();
      setIsLoading(false);
      return;
    }

    try {
      const fragment = processMixedContentSafely(content, displayMode);
      el.replaceChildren(fragment);
      setIsLoading(false);
    } catch {
      // Unrenderable content falls back to its plain text (no console output, Codex audit
      // finding 1, 2026-10-05).
      el.textContent = content;
      setIsLoading(false);
    }
  }, [content, displayMode]);

  return (
    <div className={`math-renderer ${className}`} data-testid="math-content">
      {isLoading && <span className="text-muted-foreground">...</span>}
      <div ref={containerRef} style={{ display: isLoading ? 'none' : 'block' }} />
    </div>
  );
}

function processMixedContentSafely(content: string, defaultDisplayMode: boolean): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokens = tokenizeContent(content, defaultDisplayMode);

  for (const token of tokens) {
    if (token.type === 'text') {
      // Convert caret exponents in plain text only
      fragment.appendChild(renderCaretSuperscriptsToFragment(token.content));
      continue;
    }

    const mathSpan = document.createElement('span');
    /**
     * @spec [owner QA list (Karl, 2026-10-07) item 15: "math expressions don't break
     *        mid-expression (keep each expression on one line via white-space: nowrap on the
     *        rendered math span)"] | @implemented [2026-10-07]
     * plain English: KaTeX lays an inline expression out as a row of inline blocks, and the
     * browser may wrap between any two of them, splitting "3x + 11 = 47" across lines. An inline
     * expression is kept on one line; the text around it still wraps. Display math is its own
     * block and is left alone.
     */
    if (!token.displayMode) {
      mathSpan.style.whiteSpace = 'nowrap';
      mathSpan.dataset.mathInline = 'true';
    }
    try {
      katex.render(token.content, mathSpan, {
        displayMode: token.displayMode,
        throwOnError: false,
        trust: false,
        strict: 'warn',
      });
    } catch {
      // Safe fallback: show original delimiters as text
      const wrapped =
        token.wrapper === 'slash'
          ? token.displayMode
            ? `\\[${token.content}\\]`
            : `\\(${token.content}\\)`
          : token.displayMode
            ? `$$${token.content}$$`
            : `$${token.content}$`;
      mathSpan.textContent = wrapped;
    }
    fragment.appendChild(mathSpan);
  }

  return fragment;
}

/**
 * Converts caret exponent patterns in plain text to DOM nodes with <sup>.
 *
 * Examples supported:
 *  - x^2, x^10
 *  - x^-2
 *  - x^(10), x^(-2)
 *  - x^{10}, x^{-2}
 *  - (x+1)^2 (simple paren base without nested parens)
 *  - [x]^3   (simple bracket base without nested brackets)
 *
 * Conservative by design: only clear exponent patterns are transformed.
 */
function renderCaretSuperscriptsToFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!text) return fragment;

  // exponent forms:
  //  - digits: 10
  //  - signed digits: -2
  //  - (digits) / (-digits)
  //  - {digits} / {-digits}
  const expRe = '(\\d+|-\\d+|\\(\\-?\\d+\\)|\\{\\-?\\d+\\})';

  const patterns: Array<{ re: RegExp; render: (m: RegExpExecArray) => Node[] }> = [
    {
      // ( ... )^exp or [ ... ]^exp  (no newlines, no nested of same type)
      re: new RegExp(`(\\([^\\n()]{1,400}\\)|\\[[^\\n\\[\\]]{1,400}\\])\\^(${expRe})`, 'g'),
      render: (m) => {
        const base = m[1];
        let exp = m[2];

        if (
          (exp.startsWith('(') && exp.endsWith(')')) ||
          (exp.startsWith('{') && exp.endsWith('}'))
        ) {
          exp = exp.slice(1, -1);
        }

        const nodes: Node[] = [];
        nodes.push(document.createTextNode(base));

        const sup = document.createElement('sup');
        sup.textContent = exp;
        nodes.push(sup);

        return nodes;
      },
    },
    {
      // single-character base: x^exp, 5^exp, )^exp, ]^exp
      re: new RegExp(`([A-Za-z0-9\\)\\]])\\^(${expRe})`, 'g'),
      render: (m) => {
        const base = m[1];
        let exp = m[2];

        if (
          (exp.startsWith('(') && exp.endsWith(')')) ||
          (exp.startsWith('{') && exp.endsWith('}'))
        ) {
          exp = exp.slice(1, -1);
        }

        const nodes: Node[] = [];
        nodes.push(document.createTextNode(base));

        const sup = document.createElement('sup');
        sup.textContent = exp;
        nodes.push(sup);

        return nodes;
      },
    },
  ];

  let cursor = 0;

  while (cursor < text.length) {
    let bestMatch:
      | { idx: number; len: number; m: RegExpExecArray; p: typeof patterns[number] }
      | null = null;

    for (const p of patterns) {
      p.re.lastIndex = cursor;
      const m = p.re.exec(text);
      if (!m) continue;

      const idx = m.index;
      const len = m[0].length;

      // prefer earliest; if tie, prefer longer (more specific)
      if (!bestMatch || idx < bestMatch.idx || (idx === bestMatch.idx && len > bestMatch.len)) {
        bestMatch = { idx, len, m, p };
      }
    }

    if (!bestMatch) break;

    const before = text.slice(cursor, bestMatch.idx);
    if (before) fragment.appendChild(document.createTextNode(before));

    for (const node of bestMatch.p.render(bestMatch.m)) fragment.appendChild(node);

    cursor = bestMatch.idx + bestMatch.len;
  }

  const tail = text.slice(cursor);
  if (tail) fragment.appendChild(document.createTextNode(tail));

  return fragment;
}

export default MathRenderer;
