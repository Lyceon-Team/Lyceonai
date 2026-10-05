/**
 * The Question of the Day loading line — one element for the widget's own pending state and the
 * homepage's lazy placeholder, so the prerendered HTML and the hydrated page show the same thing.
 */
export function QotdLoading(): JSX.Element {
  return (
    <p className="text-muted-foreground" data-testid="qotd-loading">
      Loading today&apos;s question…
    </p>
  );
}
