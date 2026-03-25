import { useMemo } from "react";
import { useSearch } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { parsePracticeDurationFromSearch } from "@/lib/practice-duration";

export default function MathPracticePage() {
  const search = useSearch();
  const targetMinutes = useMemo(() => parsePracticeDurationFromSearch(search), [search]);

  return (
    <CanonicalPracticePage
      title="Math Practice"
      badgeLabel="Math"
      section="math"
      targetMinutes={targetMinutes}
    />
  );
}
