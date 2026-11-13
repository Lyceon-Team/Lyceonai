/**
 * Mixed text + LaTeX rendered during render (not in an effect), for prerendered pages.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q3; owner Step 0 decision 4, 2026-10-05
 *       ("server-side KaTeX renderToString for archive pages")] | @implemented [2026-10-05]
 *
 * plain English: MathRenderer draws KaTeX into the DOM inside an effect, which never runs in the
 * build-time render, so a prerendered page would show raw `$...$`. This splits the text with
 * the SAME tokenizer MathRenderer uses (tokenizeMathContent — one tokenizer, not two) and renders
 * each math piece with `katex.renderToString`, so the static HTML a crawler reads carries the
 * typeset maths. Plain text is React text (escaped); the only raw HTML is KaTeX's own output
 * with `trust: false`, which escapes its input. A piece KaTeX cannot parse falls back to its
 * source text.
 *
 * trade-off: MathRenderer's caret-superscript nicety for plain text (x^2 outside LaTeX) is not
 * repeated here; archive text shows it as written.
 */
import katex from "katex";
import "katex/dist/katex.min.css";
import "@/styles/question-table.css";
import { tokenizeMathContent } from "@/components/MathRenderer";
import {
  findUnderlineMarkup,
  isUnderlined,
  splitByUnderlineMarkup,
} from "@shared/question-markup";
import {
  normalizeLineEndings,
  splitTableBlocks,
  trimAtTableBoundary,
  type TableAlignment,
} from "@shared/question-tables";

function renderMath(latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: "ignore",
    });
  } catch (err: unknown) {
    // Expected for malformed LaTeX: the caller shows the source text instead.
    if (err instanceof katex.ParseError) return null;
    throw err;
  }
}

/**
 * Content with its markdown tables drawn as real tables, everything else unchanged.
 *
 * @spec [owner brief 2026-11-04, approach A; "Implement it once in shared code so both
 *        MathRenderer and StaticMath use it"] | @implemented [2026-11-04]
 *
 * plain English: the SAME `splitTableBlocks` the client renderer uses says where the tables are,
 * so the prerendered page and the live page cannot disagree about what is a table. Each run of
 * ordinary content, and each cell, goes through `StaticMathRun` — the component this file has
 * always been. Expected outcome: a question without a table renders exactly as before, because
 * that is one run and nothing else.
 *
 * The only raw HTML here is still KaTeX's own output with `trust: false`; cell text is React
 * text, escaped.
 */
export function StaticMath({
  content: source,
  className,
}: {
  content: string;
  className?: string;
}): JSX.Element {
  // Normalised ONCE, as in MathRenderer, so the prerendered page and the live page agree.
  const content = normalizeLineEndings(source);
  const segments = splitTableBlocks(content);
  if (segments.length === 1 && segments[0]!.kind === "text") {
    return <StaticMathRun content={content} className={className} />;
  }
  // A <table> may not live inside a <span>, and a span's vertical margins do nothing — so the
  // moment there IS a table this renders as a block. Content without one keeps the inline <span>
  // this component has always been, because its callers lay it out inline.
  return (
    <div className={className}>
      {segments.map((segment, i) => {
        if (segment.kind === "text") {
          const slice = trimAtTableBoundary(
            content.slice(segment.start, segment.end),
            {
              tableBefore: segments[i - 1]?.kind === "table",
              tableAfter: segments[i + 1]?.kind === "table",
            },
          );
          if (slice === "") return null;
          return <StaticMathRun key={segment.start} content={slice} />;
        }
        return (
          <StaticTable
            key={segment.start}
            header={segment.header}
            align={segment.align}
            rows={segment.rows}
          />
        );
      })}
    </div>
  );
}

function StaticCell({
  tag: Tag,
  text,
  align,
}: {
  tag: "th" | "td";
  text: string;
  align: TableAlignment;
}): JSX.Element {
  return (
    <Tag {...(align === null ? {} : { "data-align": align })}>
      <StaticMathRun content={text} />
    </Tag>
  );
}

function StaticTable({
  header,
  align,
  rows,
}: {
  header: readonly string[];
  align: readonly TableAlignment[];
  rows: readonly (readonly string[])[];
}): JSX.Element {
  return (
    <div className="question-table-wrap">
      <table className="question-table">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <StaticCell
                key={`h${i}`}
                tag="th"
                text={cell}
                align={align[i] ?? null}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={`r${r}`}>
              {row.map((cell, i) => (
                <StaticCell
                  key={`c${i}`}
                  tag="td"
                  text={cell}
                  align={align[i] ?? null}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One run of ordinary content: this file's original component, unchanged. */
function StaticMathRun({
  content,
  className,
}: {
  content: string;
  className?: string;
}): JSX.Element {
  const tokens = tokenizeMathContent(content);
  // A paired <u>...</u> draws a real underline, exactly as MathRenderer does
  // (shared/question-markup.ts, 2026-10-11): tags dropped by position, text in a React <u>.
  const markup = findUnderlineMarkup(
    content,
    tokens
      .filter((t) => t.type === "math")
      .map((t) => ({ start: t.rawStart, end: t.rawEnd })),
  );
  return (
    <span className={className}>
      {tokens.map((token) => {
        if (token.type === "text") {
          if (markup.tags.length === 0) {
            return <span key={token.rawStart}>{token.content}</span>;
          }
          return (
            <span key={token.rawStart}>
              {splitByUnderlineMarkup(markup, token.rawStart, token.rawEnd).map(
                (piece) => {
                  if (piece.kind === "tag") return null;
                  const text = content
                    .slice(piece.start, piece.end)
                    .replace(/\\\$/g, "$");
                  return piece.underlined ? (
                    <u key={piece.start}>{text}</u>
                  ) : (
                    <span key={piece.start}>{text}</span>
                  );
                },
              )}
            </span>
          );
        }
        const html = renderMath(token.content, token.displayMode);
        const node =
          html === null ? (
            <span key={token.rawStart}>
              {content.slice(token.rawStart, token.rawEnd)}
            </span>
          ) : (
            <span
              key={token.rawStart}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        return isUnderlined(markup, token.rawStart, token.rawEnd) ? (
          <u key={token.rawStart}>{node}</u>
        ) : (
          node
        );
      })}
    </span>
  );
}
