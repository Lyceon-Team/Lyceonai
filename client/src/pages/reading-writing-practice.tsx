import { useMemo } from "react";
import { useSearch } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { parsePracticeDurationFromSearch } from "@/lib/practice-duration";

export default function ReadingWritingPracticePage() {
  const search = useSearch();
  const targetMinutes = useMemo(() => parsePracticeDurationFromSearch(search), [search]);

  return (
    <CanonicalPracticePage
      title="Reading & Writing Practice"
      badgeLabel="Reading & Writing"
      section="reading_writing"
      targetMinutes={targetMinutes}
    />
  );
}
