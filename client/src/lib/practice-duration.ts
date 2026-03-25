const ALLOWED_DURATION_MINUTES = new Set([10, 15, 30, 60]);

export function normalizePracticeDuration(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || !ALLOWED_DURATION_MINUTES.has(parsed)) {
    return undefined;
  }
  return parsed;
}

export function appendPracticeDuration(path: string, value: string | number | null | undefined): string {
  const normalized = normalizePracticeDuration(value);
  if (!normalized) return path;
  const [basePath, rawQuery = ""] = path.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set("duration", String(normalized));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function parsePracticeDurationFromSearch(search: string): number | undefined {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  return normalizePracticeDuration(params.get("duration"));
}
