import { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '@/styles/question-table.css';
import {
  tokenizeContent,
  tokenizeMathContent,
  type MathContentToken,
} from '@shared/math/tokenize';
import {
  findUnderlineMarkup,
  isUnderlined,
  splitByUnderlineMarkup,
} from '@shared/question-markup';
import {
  normalizeLineEndings,
  splitTableBlocks,
  trimAtTableBoundary,
  type TableAlignment,
} from '@shared/question-tables';

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
      const fragment = renderContentSafely(content, displayMode);
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

/**
 * Content with its markdown tables drawn as real tables, everything else unchanged.
 *
 * @spec [owner brief 2026-11-04, approach A ("render the text exactly as today, and build a real
 *        <table> with createElement, running each cell through the existing math tokenizer")]
 * | @implemented [2026-11-04]
 *
 * plain English: `splitTableBlocks` says where the tables are; each run of ordinary content goes
 * through `processMixedContentSafely` exactly as the whole string did before, and each cell goes
 * through the SAME function. Expected outcome: a question without a table renders byte for byte
 * as it did, because for that content this function calls the old one once on the whole string
 * and returns its fragment.
 *
 * STILL NO HTML IS PARSED. Every node here is `createElement` or `createTextNode`, as the rest
 * of this file is; a cell's text reaches the DOM through the tokenizer and `textContent`, never
 * through `innerHTML`.
 */
function renderContentSafely(
  source: string,
  defaultDisplayMode: boolean,
): DocumentFragment {
  // Normalised ONCE, here, so every offset below indexes the same string and no carriage
  // return reaches a `white-space: pre-wrap` container as a segment break of its own.
  const content = normalizeLineEndings(source);
  const segments = splitTableBlocks(content);
  if (segments.length === 1 && segments[0]!.kind === 'text') {
    // The overwhelmingly common case, and the one that must not change: one call, one fragment.
    return processMixedContentSafely(content, defaultDisplayMode);
  }

  const fragment = document.createDocumentFragment();
  segments.forEach((segment, i) => {
    if (segment.kind === 'text') {
      const slice = trimAtTableBoundary(
        content.slice(segment.start, segment.end),
        {
          tableBefore: segments[i - 1]?.kind === 'table',
          tableAfter: segments[i + 1]?.kind === 'table',
        },
      );
      if (slice === '') return;
      fragment.appendChild(
        processMixedContentSafely(slice, defaultDisplayMode),
      );
      return;
    }
    fragment.appendChild(buildTable(segment.header, segment.align, segment.rows));
  });
  return fragment;
}

/** One cell: the same tokenizer path the surrounding prose takes. */
function buildCell(
  tag: 'th' | 'td',
  text: string,
  align: TableAlignment,
): HTMLTableCellElement {
  const cell = document.createElement(tag);
  if (align !== null) cell.dataset.align = align;
  cell.appendChild(processMixedContentSafely(text, false));
  return cell;
}

function buildTable(
  header: readonly string[],
  align: readonly TableAlignment[],
  rows: readonly (readonly string[])[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'question-table-wrap';
  const table = document.createElement('table');
  table.className = 'question-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  header.forEach((cell, i) => {
    headRow.appendChild(buildCell('th', cell, align[i] ?? null));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      tr.appendChild(buildCell('td', cell, align[i] ?? null));
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  return wrap;
}

function processMixedContentSafely(content: string, defaultDisplayMode: boolean): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokens = tokenizeContent(content, defaultDisplayMode);
  /**
   * @spec [shared/question-markup.ts; live bug 2026-10-11 (Text Structure and Purpose
   *        passages printed their <u>...</u> tags)] | @implemented [2026-10-11]
   * plain English: a paired `<u>...</u>` in the text draws a real underline. The tags are
   * found by position and dropped; the text between them goes into a `<u>` ELEMENT built
   * with createElement, so content is still never parsed as HTML. Any other tag, or an
   * unpaired one, stays literal text.
   */
  const markup = findUnderlineMarkup(
    content,
    tokens
      .filter((t) => t.type === 'math')
      .map((t) => ({ start: t.rawStart, end: t.rawEnd })),
  );

  for (const token of tokens) {
    if (token.type === 'text') {
      if (markup.tags.length === 0) {
        // Convert caret exponents in plain text only
        fragment.appendChild(renderCaretSuperscriptsToFragment(token.content));
        continue;
      }
      for (const piece of splitByUnderlineMarkup(markup, token.rawStart, token.rawEnd)) {
        if (piece.kind === 'tag') continue;
        // A raw slice still carries `\$` escapes, which the tokenizer drew as `$`.
        const run = renderCaretSuperscriptsToFragment(
          content.slice(piece.start, piece.end).replace(/\\\$/g, '$'),
        );
        fragment.appendChild(piece.underlined ? wrapUnderline(run) : run);
      }
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
    fragment.appendChild(
      isUnderlined(markup, token.rawStart, token.rawEnd) ? wrapUnderline(mathSpan) : mathSpan,
    );
  }

  return fragment;
}

function wrapUnderline(node: Node): HTMLElement {
  const u = document.createElement('u');
  u.appendChild(node);
  return u;
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
