/**
 * The guardian Dashboard's mastery card (G5-03).
 *
 * @spec [Guardian_Closure_Plan G5-03; ruling R13 (Karl, 2026-10-02: the guardian Dashboard is
 *       guardian-only and follows the design, superseding R11 for this tab); the canvas boards
 *       "Wave 5 — BUILD TARGET"; owner ruling 2026-08-20 RULE 1 (level names from
 *       `mastery_levels`) and RULE 3 (unmeasured is its own state); owner decision 2026-10-01
 *       (always the eight domains); SCL-194 (guardians see no skills); R12 (16px floor)]
 *       | @implemented [2026-10-02]
 *
 * plain English: mastery by domain as two columns, Reading and Writing then Math, each domain
 * one row — its name, a five-segment meter, the level pill on the right — and a legend of the
 * levels on the page. Phone: one column; each row's name and pill share a line and the meter
 * spans the row beneath. Presentational only: it is handed the served domains and reads
 * nothing itself.
 *
 * ALWAYS THE EIGHT. Rows come from `CANONICAL_DOMAINS_BY_SECTION`, the server's list and order;
 * a served row lends its level and the server's words, and a domain with no row is
 * "Not enough answers yet" (`unmeasured`) with an empty meter — never a missing row. (The same
 * rule as the student `DomainGrid`, which R13 leaves untouched; this card does not render it.)
 *
 * COLOURS ARE THE LIVE ONES. The pill wears `levelTone(levelKey)` — the classes `LevelPill`
 * uses — and the meter and legend swatches its ink (`levelInk`); the fill count is
 * `masteryMeterFill`, the student meter's rule. No colour table, no hex, no level name here.
 * Nothing skill-related is drawn, and there is no control of any kind.
 */
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import {
  UNMEASURED_DISPLAY_NAME,
  type MasteryLevelKey,
} from "@lyceon/shared/mastery-levels";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";
import { levelTone } from "@/components/mastery/LevelPill";
import {
  levelInk,
  MASTERY_METER_SEGMENTS,
  masteryMeterFill,
} from "@/components/mastery/MasteryMeter";
import type { MasteryDomainNode, MasterySection } from "@/lib/masteryApi";

/** The design's column order: Reading and Writing on the left, Math on the right. */
const SECTIONS: readonly MasterySection[] = ["RW", "M"];

/** Legend order: the measured levels low to high, then "not enough answers yet". */
const LEGEND_ORDER: readonly MasteryLevelKey[] = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
  "unmeasured",
];

function nodesFor(
  domains: readonly MasteryDomainNode[],
  section: MasterySection,
): MasteryDomainNode[] {
  const served = new Map(domains.map((d) => [`${d.section}:${d.domain}`, d]));
  return CANONICAL_DOMAINS_BY_SECTION[section].map(
    (domain): MasteryDomainNode =>
      served.get(`${section}:${domain}`) ?? {
        section,
        domain,
        levelKey: "unmeasured",
        level: null,
        displayName: UNMEASURED_DISPLAY_NAME,
      },
  );
}

/** The pill: the level's `levelTone` fill and text, no border, the server's name verbatim. */
function Pill({ node }: { node: MasteryDomainNode }): JSX.Element {
  const tone = levelTone(node.levelKey)
    .split(" ")
    .filter((c) => !c.startsWith("border-"))
    .join(" ");
  return (
    <span
      className={`whitespace-nowrap rounded-full px-3 py-[5px] text-base font-semibold ${tone}`}
      data-testid="mastery-pill"
      data-level-key={node.levelKey}
    >
      {node.displayName}
    </span>
  );
}

function Meter({ node }: { node: MasteryDomainNode }): JSX.Element {
  const filled = masteryMeterFill(node.level);
  const ink = levelInk(node.levelKey);
  return (
    <span
      role="img"
      aria-label={`Mastery: ${node.displayName}, ${filled} of ${MASTERY_METER_SEGMENTS}`}
      className="flex w-full gap-1"
      data-testid="mastery-row-meter"
    >
      {Array.from({ length: MASTERY_METER_SEGMENTS }, (_unused, index) => {
        const on = index < filled;
        return (
          <span
            key={index}
            aria-hidden="true"
            data-segment={index + 1}
            data-filled={on ? "true" : "false"}
            className={`h-2 flex-1 rounded-[5px] sm:h-2.5 ${on ? `${ink} bg-current` : "bg-muted"}`}
          />
        );
      })}
    </span>
  );
}

function Row({ node }: { node: MasteryDomainNode }): JSX.Element {
  return (
    <div
      className="flex flex-col gap-2 border-t border-[color:var(--cream-200)] py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_150px_130px] sm:items-center sm:gap-4 sm:py-3.5"
      data-testid="mastery-row"
      data-domain={node.domain}
    >
      {/* Phone: name and pill on one line, the meter beneath. Desktop: three grid cells. */}
      <div className="flex items-center justify-between gap-2 sm:contents">
        <span className="text-left text-base font-medium">{node.domain}</span>
        <span className="sm:order-last sm:justify-self-end">
          <Pill node={node} />
        </span>
      </div>
      <Meter node={node} />
    </div>
  );
}

export function GuardianMasteryCard({
  domains,
}: {
  domains: readonly MasteryDomainNode[];
}): JSX.Element {
  const columns = SECTIONS.map((section) => ({
    section,
    nodes: nodesFor(domains, section),
  }));
  const present = new Map<MasteryLevelKey, string>();
  for (const { nodes } of columns) {
    for (const n of nodes) {
      if (!present.has(n.levelKey)) present.set(n.levelKey, n.displayName);
    }
  }
  const legend = LEGEND_ORDER.flatMap((key) => {
    const name = present.get(key);
    return name === undefined ? [] : [{ key, name }];
  });
  return (
    <section
      className="flex flex-col gap-1 rounded-[18px] border border-[color:var(--cream-300)] bg-white px-4 py-[18px] sm:gap-5 sm:rounded-[20px] sm:px-8 sm:py-7"
      data-testid="mastery-card"
    >
      <div className="flex flex-col items-center sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 className="m-0 mb-1.5 text-center text-[19px] font-bold sm:mb-0 sm:text-left sm:text-xl">
          Mastery by domain
        </h2>
        {/* The legend is the desktop board's; the phone board draws none. */}
        <div className="hidden gap-3.5 sm:flex" data-testid="mastery-legend">
          {legend.map((item) => (
            <span
              key={item.key}
              className="flex items-center gap-1.5 text-base text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 rounded-[3px] bg-current ${levelInk(item.key)}`}
              />
              <span data-testid="mastery-legend-item">{item.name}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col sm:grid sm:grid-cols-2 sm:gap-10">
        {columns.map(({ section, nodes }) => (
          <div
            key={section}
            className="flex flex-col"
            data-testid={`mastery-column-${section}`}
          >
            <div
              className="pb-0.5 pt-2.5 text-center text-base font-semibold uppercase tracking-[0.05em] text-muted-foreground sm:pb-2 sm:pt-0 sm:text-left"
              data-testid="mastery-section-label"
            >
              {EXAM_SECTION_LABEL[section]}
            </div>
            {nodes.map((node) => (
              <Row key={node.domain} node={node} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
