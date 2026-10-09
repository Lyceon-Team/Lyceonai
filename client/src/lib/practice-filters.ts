/** Allowed difficulty values for a practice session. */
export type PracticeDifficulty = "easy" | "medium" | "hard";

const ALLOWED_DIFFICULTIES = new Set<PracticeDifficulty>(["easy", "medium", "hard"]);

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

export function normalizePracticeDifficulties(raw: string[]): PracticeDifficulty[] {
  const seen = new Set<PracticeDifficulty>();
  for (const item of raw) {
    const s = item.trim().toLowerCase();
    if (s === "easy" || s === "medium" || s === "hard") {
      seen.add(s as PracticeDifficulty);
    }
  }
  return (["easy", "medium", "hard"] as PracticeDifficulty[]).filter((d) => seen.has(d));
}

export function parseDifficultiesFromSearch(search: string): PracticeDifficulty[] {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  return normalizePracticeDifficulties(params.getAll("difficulty"));
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function parseDomainsFromSearch(search: string): string[] {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  return params
    .getAll("domain")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

// ---------------------------------------------------------------------------
// URL builder — appends filter params alongside any existing params
// ---------------------------------------------------------------------------

export interface PracticeFilters {
  difficulties?: PracticeDifficulty[];
  domains?: string[];
}

export function appendPracticeFilters(path: string, filters: PracticeFilters): string {
  const [basePath, rawQuery = ""] = path.split("?");
  const params = new URLSearchParams(rawQuery);

  // Remove any stale filter params before writing fresh ones
  params.delete("difficulty");
  params.delete("domain");

  for (const d of filters.difficulties ?? []) {
    if (ALLOWED_DIFFICULTIES.has(d)) {
      params.append("difficulty", d);
    }
  }
  for (const domain of filters.domains ?? []) {
    const trimmed = domain.trim();
    if (trimmed.length > 0) {
      params.append("domain", trimmed);
    }
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
