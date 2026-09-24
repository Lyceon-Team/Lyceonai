/**
 * §17.2's domain rows — the one editor for a practice block's mix.
 *
 * @spec [Doc_05F_V1.0 §17.2 day editor, §21 (`max_domains_per_block`, granularity)]
 * | @implemented [2026-09-24]
 *
 * plain English: the "what this session covers" control — one row per domain, each with a
 * question count, plus the add and remove controls and the rules about how many rows there
 * may be.
 *
 * WHY IT IS ITS OWN FILE. It was inside `BlockSheet`, reachable only when editing a block
 * that already existed. §17.2's create form needs the SAME control with the same rules, and
 * a second copy would be two places to change the domain cap — the exact divergence
 * CLAUDE.md's "search for an existing canonical one and consume it" forbids. So the editing
 * path and the create path now render this, and neither owns it.
 *
 * expected outcome: whichever path a student came in by, the same domains are offered, the
 * same counts, the same cap, and the last row cannot be removed.
 *
 * edge cases: `available` is the block's OWN section only. Offering a Math domain on a
 * Reading & Writing block would offer a choice `calendar_scope_is_valid` refuses, and a
 * control that leads to a server error is worse than a control that never offered it.
 */
import type { CanonicalDomain } from "@lyceon/shared/calendar";
import { domainsForSection } from "../lib/blocks";
import { MAX_DOMAINS_PER_BLOCK, MIX_GRANULARITY, mixCountChoices } from "../lib/members";

export type MixEntry = { domain: CanonicalDomain; count: number };

export function MixRows({
  section,
  mix,
  disabled,
  onChange,
}: {
  section: "M" | "RW";
  mix: readonly MixEntry[];
  disabled: boolean;
  onChange: (mix: readonly MixEntry[]) => void;
}): JSX.Element {
  const available = domainsForSection(section);
  const used = new Set(mix.map((entry) => entry.domain));
  const nextUnused = available.find((domain) => !used.has(domain));

  return (
    <div className="field" data-testid="calendar-mix-rows">
      <label>What this session covers</label>
      {mix.map((entry, index) => (
        <div className="mixrow" key={entry.domain}>
          <select
            disabled={disabled}
            value={entry.domain}
            aria-label={`Domain ${index + 1}`}
            onChange={(event) => {
              const domain = event.target.value as CanonicalDomain;
              onChange(
                mix.map((row, i) => (i === index ? { ...row, domain } : row)),
              );
            }}
          >
            {available.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
          <select
            disabled={disabled}
            value={entry.count}
            aria-label={`Questions for ${entry.domain}`}
            onChange={(event) => {
              const count = Number(event.target.value);
              onChange(
                mix.map((row, i) => (i === index ? { ...row, count } : row)),
              );
            }}
          >
            {mixCountChoices().map((count) => (
              <option key={count} value={count}>
                {count} questions
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled || mix.length <= 1}
            aria-label={`Remove ${entry.domain}`}
            onClick={() => onChange(mix.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      {!disabled &&
      mix.length < MAX_DOMAINS_PER_BLOCK &&
      nextUnused !== undefined ? (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          onClick={() =>
            onChange([...mix, { domain: nextUnused, count: MIX_GRANULARITY }])
          }
        >
          + Add a domain
        </button>
      ) : null}
    </div>
  );
}
