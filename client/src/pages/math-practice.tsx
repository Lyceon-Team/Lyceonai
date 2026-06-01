import { useMemo } from "react";
import { useSearch } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { parsePracticeDurationFromSearch } from "@/lib/practice-duration";
import { parseDifficultiesFromSearch, parseDomainsFromSearch } from "@/lib/practice-filters";

export default function MathPracticePage() {
  const search = useSearch();
  const targetMinutes = useMemo(() => parsePracticeDurationFromSearch(search), [search]);
  const difficulties = useMemo(() => parseDifficultiesFromSearch(search), [search]);
  const domains = useMemo(() => parseDomainsFromSearch(search), [search]);

  return (
    <CanonicalPracticePage
      title="Math Practice"
      badgeLabel="Math"
      section="math"
      targetMinutes={targetMinutes}
      difficulties={difficulties.length > 0 ? difficulties : undefined}
      domains={domains.length > 0 ? domains : undefined}
    />
  );
}
