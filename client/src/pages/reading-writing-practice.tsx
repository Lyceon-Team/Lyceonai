import { useMemo } from "react";
import { useSearch } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { parsePracticeDurationFromSearch } from "@/lib/practice-duration";
import { parseDifficultiesFromSearch, parseDomainsFromSearch } from "@/lib/practice-filters";

export default function ReadingWritingPracticePage() {
  const search = useSearch();
  const targetMinutes = useMemo(() => parsePracticeDurationFromSearch(search), [search]);
  const difficulties = useMemo(() => parseDifficultiesFromSearch(search), [search]);
  const domains = useMemo(() => parseDomainsFromSearch(search), [search]);

  return (
    <CanonicalPracticePage
      title="Reading & Writing Practice"
      badgeLabel="Reading & Writing"
      section="reading_writing"
      targetMinutes={targetMinutes}
      difficulties={difficulties.length > 0 ? difficulties : undefined}
      domains={domains.length > 0 ? domains : undefined}
    />
  );
}
