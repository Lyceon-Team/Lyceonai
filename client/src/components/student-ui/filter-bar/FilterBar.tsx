import { useId, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  clearAll,
  difficultyOptions,
  domainOptions,
  filterChips,
  normalizeFilter,
  removeChip,
  sectionOptions,
  selectSection,
  skillOptions,
  toggleDifficulty,
  toggleDomain,
  toggleSkill,
  type FilterBarValue,
  type FilterOption,
} from "./filter-cascade";

/**
 * @spec [student-UI register §2 "Filters", §6 UI-43; DESIGN.md §3 "Filter bar", §4 Practice and
 *       Review; prototype Practice.dc.html "What to practice"; register §2 "Content and data
 *       rules": students never see question-bank counts] | @implemented [2026-10-03]
 *
 * plain English: the one filter bar Practice and Review share, modelled on the College Board
 * Question Bank: a Section switch, a "Your criteria" row of chips (a fixed Section chip, then one
 * removable chip per chosen domain, skill and difficulty, and "Clear all"), and Domain, Skill and
 * Difficulty multi-select dropdowns. Controlled: `value` + `onChange`; the taxonomy is passed in
 * as data (the `GET /api/practice/topics` body), so the bar fetches nothing. Every change goes
 * through the pure cascade module (`filter-cascade.ts`), which owns the rules.
 * expected outcome: `onChange` only ever receives a normalised value. Labels are the taxonomy's
 * display names. No count of any kind is rendered: not a bank count, and not even the number of
 * choices in a dropdown (the prototype's "Domain (2)" is shown as a filled trigger instead), so
 * the rendered bar carries no digits at all.
 * trade-offs: the dropdowns are the canonical Radix DropdownMenu with checkbox items, which give
 * arrow-key movement, Enter/Space toggling and Esc to close; selecting an item keeps the menu
 * open so several can be chosen. The menu renders in a portal, so it carries the `.lyc` root.
 * edge cases: a value holding stale choices is normalised before it is drawn; an empty skill list
 * (no published skills yet) shows a sentence, never an empty menu; with no section chosen the
 * Section chip is omitted and every domain is offered (OQ-22: empty means no constraint).
 */

type FilterBarProps = {
  taxonomy: PracticeTopicsResponse;
  value: FilterBarValue;
  onChange: (next: FilterBarValue) => void;
  /** Accessible name of the bar's region. */
  label?: string;
  className?: string;
};

const ROW_LABEL = "w-[110px] shrink-0 text-lyc-body font-semibold text-lyc-ink";

const CHIP =
  "inline-flex items-center gap-1 rounded-md bg-lyc-chip text-lyc-body text-lyc-ink-strong";

type MenuProps = {
  name: string;
  hint: string;
  emptyText: string;
  options: FilterOption[];
  chosen: readonly string[];
  onToggle: (value: string) => void;
  onOpenChange: (open: boolean) => void;
};

function FilterMenu({
  name,
  hint,
  emptyText,
  options,
  chosen,
  onToggle,
  onOpenChange,
}: MenuProps) {
  const active = chosen.length > 0;
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border pl-5 pr-4 text-lyc-body focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus",
          active
            ? "border-lyc-primary-bg bg-lyc-primary-bg text-lyc-primary-ink"
            : "border-lyc-input-bd bg-lyc-sheet text-lyc-ink",
        )}
        data-testid={`filter-menu-${name.toLowerCase()}`}
        data-active={active ? "true" : "false"}
      >
        <span>{name}</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="lyc w-[min(520px,calc(100vw-2rem))] rounded-lg border-lyc-rule-strong bg-lyc-sheet p-2.5 text-lyc-ink shadow-none"
      >
        <p className="mx-3 mb-1 mt-1 text-lyc-meta-lg text-lyc-muted">
          {options.length > 0 ? hint : emptyText}
        </p>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={chosen.includes(o.value)}
            onCheckedChange={() => onToggle(o.value)}
            // Keep the menu open so several values can be chosen in one visit.
            onSelect={(event) => event.preventDefault()}
            className="rounded-md py-2.5 pl-9 pr-3 text-lyc-body leading-snug text-lyc-ink focus:bg-lyc-hover focus:text-lyc-ink-strong"
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem className="mt-1 justify-end rounded-md px-3 py-2.5 text-lyc-body font-semibold text-lyc-ink-strong focus:bg-lyc-hover focus:text-lyc-ink-strong">
          Done
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FilterBar({
  taxonomy,
  value: rawValue,
  onChange,
  label = "What to practice",
  className,
}: FilterBarProps) {
  const value = normalizeFilter(taxonomy, rawValue);
  const sections = sectionOptions(taxonomy);
  const chosenSection = sections.find((s) => value.sections.includes(s.value));
  const liveChips = filterChips(taxonomy, value);
  const difficulties = difficultyOptions();
  const sectionLabelId = useId();
  /**
   * @spec [owner QA list (Karl, 2026-10-07) item 15: "practice filter dropdowns don't jump while
   *        open"] | @implemented [2026-10-07]
   * plain English: the chips row sits ABOVE the dropdowns, so a chip added while a menu is open
   * could wrap the row onto a new line, push the trigger down and carry the open menu with it.
   * While a menu is open the row shows the chips it had when the menu opened (the menu's own
   * checkmarks show each choice at once); it catches up the moment the menu closes. The value
   * itself changes on every pick, as before, so the summary and Start below are always current.
   */
  const [frozenChips, setFrozenChips] = useState<typeof liveChips | null>(null);
  const chips = frozenChips ?? liveChips;
  const onMenuOpenChange = (open: boolean): void => {
    setFrozenChips(open ? liveChips : null);
  };

  return (
    <section
      aria-label={label}
      data-testid="filter-bar"
      className={cn(
        "flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 sm:px-8 sm:py-7",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className={ROW_LABEL} id={sectionLabelId}>
          Section
        </span>
        <div
          role="group"
          aria-labelledby={sectionLabelId}
          className="flex overflow-hidden rounded-md border border-lyc-ink-strong"
        >
          {sections.map((s) => {
            const pressed = value.sections.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  if (!pressed)
                    onChange(selectSection(taxonomy, value, s.value));
                }}
                className={cn(
                  "h-11 px-5 text-lyc-body font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-lyc-focus",
                  pressed
                    ? "bg-lyc-primary-bg text-lyc-primary-ink"
                    : "bg-lyc-sheet text-lyc-ink-strong hover:bg-lyc-hover",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        <span className={cn(ROW_LABEL, "pt-2")}>Your criteria</span>
        <ul
          aria-label="Your criteria"
          className="m-0 flex min-h-10 flex-1 list-none flex-wrap items-center gap-2.5 p-0"
          data-testid="filter-chips"
        >
          {chosenSection ? (
            <li className={cn(CHIP, "px-3.5 py-2 font-semibold")}>
              Section: {chosenSection.label}
            </li>
          ) : null}
          {chips.map((chip) => (
            <li
              key={`${chip.kind}:${chip.value}`}
              className={cn(CHIP, "py-1 pl-3.5 pr-1")}
              data-testid="filter-chip"
            >
              <span>
                {chip.kind === "domain"
                  ? "Domain"
                  : chip.kind === "skill"
                    ? "Skill"
                    : "Difficulty"}
                : {chip.label}
              </span>
              <Button
                type="button"
                variant="lyc-quiet"
                size="lyc-icon"
                className="h-8 w-8"
                aria-label={`Remove ${chip.label}`}
                onClick={() => onChange(removeChip(taxonomy, value, chip))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {chips.length > 0 ? (
            <li>
              <Button
                type="button"
                variant="lyc-quiet"
                className="px-1 underline underline-offset-4"
                onClick={() => onChange(clearAll(taxonomy, value))}
              >
                Clear all
              </Button>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        <span className={cn(ROW_LABEL, "pt-2.5")}>Add filters</span>
        <div className="flex flex-1 flex-wrap gap-2.5">
          <FilterMenu
            name="Domain"
            onOpenChange={onMenuOpenChange}
            hint="Choose one or more domains."
            emptyText="Choose a section first."
            options={domainOptions(taxonomy, value.sections)}
            chosen={value.domains}
            onToggle={(d) => onChange(toggleDomain(taxonomy, value, d))}
          />
          <FilterMenu
            name="Skill"
            onOpenChange={onMenuOpenChange}
            hint={
              value.domains.length > 0
                ? "Skills in the domains you chose."
                : "All skills in this section. Pick a domain first to shorten the list."
            }
            emptyText="No skills are available here yet."
            options={skillOptions(taxonomy, value)}
            chosen={value.skills}
            onToggle={(s) => onChange(toggleSkill(taxonomy, value, s))}
          />
          <FilterMenu
            name="Difficulty"
            onOpenChange={onMenuOpenChange}
            hint="Choose one or more difficulty levels."
            emptyText="Choose one or more difficulty levels."
            options={difficulties}
            chosen={value.difficulties}
            onToggle={(d) => {
              const match = difficulties.find((o) => o.value === d);
              if (match)
                onChange(toggleDifficulty(taxonomy, value, match.value));
            }}
          />
        </div>
      </div>
    </section>
  );
}
