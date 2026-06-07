import { describe, it, expect } from "vitest";
import { parseEnv, safeParseEnv } from "../env.js";

const valid = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  CSRF_SECRET: "csrf-secret",
};

describe("envSchema", () => {
  it("parses a valid environment", () => {
    const env = parseEnv(valid);
    expect(env.SUPABASE_URL).toBe("https://x.supabase.co");
    expect(env.NODE_ENV).toBe("production");
  });

  it("defaults NODE_ENV to development when absent", () => {
    const { NODE_ENV, ...rest } = valid;
    expect(parseEnv(rest).NODE_ENV).toBe("development");
  });

  it("rejects a missing required var", () => {
    const { SUPABASE_URL, ...rest } = valid;
    expect(safeParseEnv(rest).success).toBe(false);
  });

  it("rejects a malformed SUPABASE_URL", () => {
    expect(safeParseEnv({ ...valid, SUPABASE_URL: "not-a-url" }).success).toBe(false);
  });

  it("rejects an unknown NODE_ENV value", () => {
    expect(safeParseEnv({ ...valid, NODE_ENV: "staging" }).success).toBe(false);
  });

  it("accepts valid optional provider keys", () => {
    const env = parseEnv({ ...valid, GEMINI_API_KEY: "k", DATABASE_URL: "postgres://h:5432/db" });
    expect(env.GEMINI_API_KEY).toBe("k");
    expect(env.DATABASE_URL).toBe("postgres://h:5432/db");
  });
});
