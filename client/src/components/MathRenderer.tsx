import { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

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
    } catch (error) {
      console.warn('MathRenderer error:', error);
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

type Token =
  | { type: 'text'; content: string }
  | { type: 'math'; content: string; displayMode: boolean; wrapper?: 'dollar' | 'slash' };

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
    try {
      katex.render(token.content, mathSpan, {
        displayMode: token.displayMode,
        throwOnError: false,
        trust: false,
        strict: 'warn',
      });
    } catch (e) {
      console.warn('KaTeX rendering error:', e);
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
function tokenizeContent(content: string, defaultDisplayMode: boolean): Token[] {
  const tokens: Token[] = [];

  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf.length > 0) {
      tokens.push({ type: 'text', content: textBuf });
      textBuf = '';
    }
  };

  while (i < content.length) {
    const ch = content[i];

    // Handle escaped dollars \$
    if (ch === '\\' && i + 1 < content.length && content[i + 1] === '$') {
      textBuf += '$';
      i += 2;
      continue;
    }

    // Handle \[ ... \] (display math)
    if (ch === '\\' && i + 1 < content.length && content[i + 1] === '[') {
      const start = i + 2;
      const end = findClosingSlashBracket(content, start); // finds \]
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({ type: 'math', content: latex, displayMode: true, wrapper: 'slash' });
        i = end + 2; // skip "\]"
        continue;
      }
      // no closing -> treat as text
      textBuf += '\\[';
      i += 2;
      continue;
    }

    // Handle \( ... \) (inline math)
    if (ch === '\\' && i + 1 < content.length && content[i + 1] === '(') {
      const start = i + 2;
      const end = findClosingSlashParen(content, start); // finds \)
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({ type: 'math', content: latex, displayMode: false, wrapper: 'slash' });
        i = end + 2; // skip "\)"
        continue;
      }
      // no closing -> treat as text
      textBuf += '\\(';
      i += 2;
      continue;
    }

    // Display math $$...$$
    if (ch === '$' && i + 1 < content.length && content[i + 1] === '$') {
      const start = i + 2;
      const end = findClosingDoubleDollar(content, start);
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({ type: 'math', content: latex, displayMode: true, wrapper: 'dollar' });
        i = end + 2;
        continue;
      }
      // No closing $$ -> treat as text
      textBuf += '$$';
      i += 2;
      continue;
    }

    // Inline math $...$
    if (ch === '$') {
      const start = i + 1;
      const end = findClosingSingleDollar(content, start);
      if (end !== -1) {
        flushText();
        const latex = content.slice(start, end).trim();
        tokens.push({
          type: 'math',
          content: latex,
          displayMode: defaultDisplayMode,
          wrapper: 'dollar',
        });
        i = end + 1;
        continue;
      }
      // No closing $ -> treat as text
      textBuf += '$';
      i += 1;
      continue;
    }

    // Normal character
    textBuf += ch;
    i += 1;
  }

  flushText();
  if (tokens.length === 0) tokens.push({ type: 'text', content });

  return tokens;
}

function findClosingDoubleDollar(s: string, fromIndex: number): number {
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === '\\' && s[i + 1] === '$') {
      i += 1;
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '$') return i;
  }
  return -1;
}

function findClosingSingleDollar(s: string, fromIndex: number): number {
  for (let i = fromIndex; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '$') {
      i += 1;
      continue;
    }
    if (s[i] === '$') return i;
  }
  return -1;
}

function findClosingSlashBracket(s: string, fromIndex: number): number {
  // Finds "\]" starting at fromIndex
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === '\\' && s[i + 1] === ']') return i;
  }
  return -1;
}

function findClosingSlashParen(s: string, fromIndex: number): number {
  // Finds "\)" starting at fromIndex
  for (let i = fromIndex; i < s.length - 1; i++) {
    if (s[i] === '\\' && s[i + 1] === ')') return i;
  }
  return -1;
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
