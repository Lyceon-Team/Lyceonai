/**
 * The Lyceon brand mark, the one component every surface draws it with.
 *
 * @spec [owner request 2026-10-09 (Karl): "replace the graduation-cap mark at the top of the rail
 *       (and anywhere else the app uses it as the brand mark) with the Lyceon logo ... same size
 *       and spacing; light and dark"; G4-07 (R12); owner decision 2026-10-01 item 9]
 *       | @implemented [2026-10-09]
 *
 * Moved here from GuardianShell.tsx, where it was the guardian header's mark, so the app rail, the
 * mobile top bar and the public nav and footer draw the same thing rather than a second copy.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * G4-07 (R12): the real Lyceon logo, not a graduation-cap icon. The one logo asset,
 * `client/public/lyceon-logo.png`, is a square — the hexagon-and-book mark above the
 * LYCEON wordmark, on an OPAQUE cream (rgb 250 244 232). The <image> below draws it into a
 * 1024-unit square whatever its pixel size, so the coordinates here are in those units (the
 * file itself is 512px since SEO Wave 1B F8, 2026-10-03, down from 1024px). At header size the
 * wordmark would be unreadably small, so the viewBox shows only the MARK (centred at 512, 420
 * of 1024, about 404 units tall); the word "Lyceon" beside it is live text. No second asset
 * is made.
 *
 * NO SQUARE BEHIND THE MARK (owner decision 2026-10-01, item 9). Drawn as a plain image, the
 * asset's cream showed as a square on the header's own, lighter cream background, and as a bright
 * one in dark mode. So the mark is drawn through an SVG filter instead: the asset's luminance
 * becomes its alpha (cream → transparent, the navy mark → opaque, the anti-aliased edge in
 * between) and the mark is painted in `currentColor` — the header's text colour, so it is
 * navy on cream and cream on navy. The browser check in `tests/e2e/guardian-surfaces.spec.ts`
 * reads the pixels at the mark's corners and requires them to be the header's.
 */
export function LyceonMark({
  className,
  decorative = false,
  testId = "lyceon-logo",
}: {
  /** Size and colour. The mark is painted in `currentColor`, so a `text-*` class (or the parent's colour) sets it. */
  className: string;
  /**
   * True where the word "Lyceon" is already beside the mark (the app rail, the public nav and
   * footer): the mark is then hidden from assistive technology, as the icon it replaced was,
   * so a screen reader does not say "Lyceon Lyceon".
   */
  decorative?: boolean;
  testId?: string;
}): JSX.Element {
  const filterId = `lyceon-mark-${React.useId().replace(/:/g, "")}`;
  // alpha = 1.6 − 2 × luminance (Rec. 709 weights): anything at or above L 0.8 — the cream and
  // its slightly darker grain (L ≈ 0.9–0.96) — is fully transparent; the navy mark
  // (L ≈ 0.18) is fully opaque.
  const ALPHA_FROM_LUMINANCE =
    "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.4252 -1.4304 -0.1444 0 1.6";
  return (
    <svg
      className={cn("block shrink-0", className)}
      viewBox="310 218 404 404"
      {...(decorative
        ? { "aria-hidden": true, focusable: "false" }
        : { role: "img", "aria-label": "Lyceon" })}
      data-testid={testId}
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values={ALPHA_FROM_LUMINANCE}
            result="ink"
          />
          <feFlood floodColor="currentColor" />
          <feComposite in2="ink" operator="in" />
        </filter>
      </defs>
      <image
        href="/lyceon-logo.png"
        x="0"
        y="0"
        width="1024"
        height="1024"
        filter={`url(#${filterId})`}
      />
    </svg>
  );
}
