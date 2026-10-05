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
import { tokenizeMathContent } from "@/components/MathRenderer";

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

export function StaticMath({
  content,
  className,
}: {
  content: string;
  className?: string;
}): JSX.Element {
  const tokens = tokenizeMathContent(content);
  return (
    <span className={className}>
      {tokens.map((token) => {
        if (token.type === "text") {
          return <span key={token.rawStart}>{token.content}</span>;
        }
        const html = renderMath(token.content, token.displayMode);
        return html === null ? (
          <span key={token.rawStart}>
            {content.slice(token.rawStart, token.rawEnd)}
          </span>
        ) : (
          <span
            key={token.rawStart}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
