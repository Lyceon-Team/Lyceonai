// server/middleware/origin-utils.ts
export function parseAllowedOrigins(envValue?: string): URL[] {
  return (envValue || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => !!u);
}

export function normalizeOrigin(input: string): string | null {
  try {
    const u = new URL(input);
    const protocol = u.protocol.toLowerCase();
    const host = u.host.toLowerCase();
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

export function buildAllowedOrigins(opts: {
  nodeEnv?: string;
  corsOriginsCsv?: string;
  csrfOriginsCsv?: string;
}) {
  const nodeEnv = opts.nodeEnv || process.env.NODE_ENV;
  const isDev = nodeEnv === "development";
  const isTest = nodeEnv === "test";

  const defaults = [
    ...parseAllowedOrigins("https://lyceon.ai,https://www.lyceon.ai"),
    ...(isTest ? parseAllowedOrigins("http://localhost:5000,http://localhost:3000,http://localhost:3001") : []),
  ];

  const envOrigins = [
    ...parseAllowedOrigins(opts.corsOriginsCsv),
    ...parseAllowedOrigins(opts.csrfOriginsCsv),
  ];

  const raw = Array.from(new Set([...defaults, ...envOrigins].map((u) => u.href)));
  const normalized = new Set(
    raw
      .map((r) => normalizeOrigin(r))
      .filter((v): v is string => !!v)
  );

  return { isDev, raw, normalized };
}

export function isAllowedRequestOrigin(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  allowed: Set<string>
): boolean {
  const method = (req.method || "").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const originHeader = req.headers.origin ?? req.headers.Origin;
  const refererHeader = req.headers.referer ?? req.headers.Referer;

  const origin = typeof originHeader === "string" ? originHeader : Array.isArray(originHeader) ? originHeader[0] : "";
  const referer = typeof refererHeader === "string" ? refererHeader : Array.isArray(refererHeader) ? refererHeader[0] : "";

  const originNorm = origin ? normalizeOrigin(origin) : null;
  const refererNorm = referer ? normalizeOrigin(referer) : null;

  if (originNorm && allowed.has(originNorm)) return true;
  if (refererNorm && allowed.has(refererNorm)) return true;

  return false;
}
