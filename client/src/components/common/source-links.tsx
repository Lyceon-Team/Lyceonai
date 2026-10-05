import type { Source } from "@shared/seo/sources";

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 3 ("General facts cite real
 *       sources"), §5 F6] | @implemented [2026-10-03] | plain English: renders the external
 * sources behind a statement about the SAT as small links under it ("Source: College Board:
 * SAT structure"). Renders nothing when there are none. The links open in a new tab and send
 * no referrer, the usual pattern for an outbound citation.
 */
export function SourceLinks({
  sources,
}: {
  sources: readonly Source[] | undefined;
}): JSX.Element | null {
  if (sources === undefined || sources.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground mt-2">
      {sources.length === 1 ? "Source: " : "Sources: "}
      {sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 && "; "}
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            {source.label}
          </a>
        </span>
      ))}
    </p>
  );
}
