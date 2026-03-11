// server/middleware/origin-utils.ts
export function normalizeOrigin(input: string): string {
  try {
    const u = new URL(input);
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase();
    let port = u.port;

    // Strip default ports
    if ((protocol === "https:" && port === "443") || (protocol === "http:" && port === "80")) {
      port = "";
    }

    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  } catch {
    // If it's not a URL, return trimmed raw
    return String(input || "").trim();
  }
}

function splitCsv(csv?: string): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildAllowedOrigins(opts: {
  nodeEnv?: string;
  corsOriginsCsv?: string;
  csrfOriginsCsv?: string;
}) {
  const nodeEnv = opts.nodeEnv || process.env.NODE_ENV;
  const isDev = nodeEnv === "development";
  const isTest = nodeEnv === "test";

  // Hard defaults for production safety
  const DEFAULTS = [
    "https://lyceon.ai",
    "https://www.lyceon.ai",
  ];

  // In test mode, add localhost origins for testing
  const TEST_DEFAULTS = isTest ? [
    "http://localhost:5000",
    "http://localhost:3000",
    "http://localhost:3001",
  ] : [];

  const DEV_DEFAULTS = isDev ? [
    "http://localhost:5173",
    "http://localhost:5000",
  ] : [];

  const fromCors = splitCsv(opts.corsOriginsCsv);
  const fromCsrf = splitCsv(opts.csrfOriginsCsv);

  // Combine all origins
  const raw = Array.from(new Set([...DEFAULTS, ...TEST_DEFAULTS, ...DEV_DEFAULTS, ...fromCors, ...fromCsrf]));

  const normalized = new Set(raw.map(normalizeOrigin));

  return { isDev, raw, normalized };
}
