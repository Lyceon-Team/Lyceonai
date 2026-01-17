export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 bg-black/80 text-white px-3 py-2 rounded z-[1000]"
      data-testid="skip-link"
    >
      Skip to content
    </a>
  );
}
