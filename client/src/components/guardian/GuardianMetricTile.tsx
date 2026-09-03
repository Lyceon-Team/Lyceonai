/**
 * One metric tile on the guardian dashboard, and the ONLY one.
 *
 * @spec [Doc-01_V8 §38 Guardian visibility model; Doc-05B guardian surfaces are
 *        domain-level] | @implemented [2026-09-03]
 *
 * plain English: renders a labelled figure in the dashboard's tile chrome, or —
 * when `locked` — the same tile with the figure replaced by a lock. Expected
 * outcome: the template preview shown to a guardian with no linked student is
 * literally the real tile, not a lookalike, so the two cannot drift apart.
 *
 * WHY `locked` RATHER THAN A SAMPLE VALUE (owner ruling 2026-09-03, option 1).
 * CLAUDE.md's mastery invariant is "Mastery is earned from observed events
 * only. Never infer, estimate, or invent." A preview that renders plausible
 * numbers inside the real dashboard chrome puts fabricated learning data about
 * a child one CSS regression away from reading as real. So the preview shows
 * the SHAPE and no figures at all: this component cannot be handed a sample
 * number, because `locked` takes no value.
 */
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

type GuardianMetricTileProps = {
  readonly label: string;
  /** The tile's own glyph — a `lucide` icon element, or the literal "%". */
  readonly icon: ReactNode;
} & (
  | { readonly locked: true; readonly value?: never }
  | { readonly locked?: false; readonly value: ReactNode }
);

export function GuardianMetricTile(props: GuardianMetricTileProps) {
  const locked = props.locked === true;
  return (
    <div
      className="bg-[#FFFAEF] p-4 rounded-lg text-center"
      data-testid={
        locked ? "guardian-metric-tile-locked" : "guardian-metric-tile"
      }
    >
      <div className="h-5 w-5 text-[#0F2E48]/60 mx-auto mb-2 flex items-center justify-center font-bold">
        {props.icon}
      </div>
      <div
        className="text-2xl font-bold text-[#0F2E48] flex items-center justify-center h-8"
        data-testid="guardian-metric-value"
      >
        {locked ? (
          <Lock
            className="h-5 w-5 text-[#0F2E48]/35"
            aria-label={`${props.label} — locked`}
          />
        ) : (
          props.value
        )}
      </div>
      <div className="text-xs text-[#0F2E48]/60">{props.label}</div>
    </div>
  );
}
