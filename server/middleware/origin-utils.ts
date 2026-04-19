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

const CANONICAL_PROD_ORIGINS = [
  "https://lyceon.ai",
  "https://www.lyceon.ai",
];

const TEST_ORIGINS = [
  "http://localhost:5000",
  "http://localhost:3000",
  "http://localhost:3001",
];

function buildLocalDevOrigins() {
  return [
    "http://localhost:5173",
    `http://localhost:${process.env.PORT || 5000}`,
  ];
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
  const DEFAULTS = CANONICAL_PROD_ORIGINS;
  const TEST_DEFAULTS = isTest ? TEST_ORIGINS : [];
  const DEV_DEFAULTS = isDev ? buildLocalDevOrigins() : [];

  const fromCors = splitCsv(opts.corsOriginsCsv);
  const fromCsrf = splitCsv(opts.csrfOriginsCsv);

  // Combine all origins
  const raw = Array.from(new Set([...DEFAULTS, ...TEST_DEFAULTS, ...DEV_DEFAULTS, ...fromCors, ...fromCsrf]));

  const normalized = new Set(raw.map(normalizeOrigin));

  return { isDev, raw, normalized };
}

/**
 * CSRF origin allowlist uses one canonical source: CSRF_ALLOWED_ORIGINS.
 * No wildcard matching; every allowed origin must be explicitly enumerated.
 */
export function buildCsrfAllowedOrigins(opts: {
  nodeEnv?: string;
  csrfOriginsCsv?: string;
}) {
  const nodeEnv = opts.nodeEnv || process.env.NODE_ENV;
  const isDev = nodeEnv === "development";
  const isTest = nodeEnv === "test";
  const configured = splitCsv(opts.csrfOriginsCsv ?? process.env.CSRF_ALLOWED_ORIGINS);
  const baseOrigins = configured.length > 0 ? configured : CANONICAL_PROD_ORIGINS;
  const localOrigins = isTest ? TEST_ORIGINS : isDev ? buildLocalDevOrigins() : [];
  const raw = Array.from(new Set([...baseOrigins, ...localOrigins]));
  const normalized = new Set(raw.map(normalizeOrigin));
  return { isDev, isTest, raw, normalized };
}
