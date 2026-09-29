// @vitest-environment jsdom
/**
 * @spec [Doc-03B_V4.1 §8.3, §8.5] | @implemented [2026-09-29]
 *
 * plain English: a round trip — the REAL `useConversations` hook against the
 * REAL `GET /api/tutor/conversations` route (database: the in-memory
 * FakeTutorDb). The hook's page payloads are whatever the route returns, not
 * a hand-written fixture, so a server/client mismatch in `pagination` fails
 * here. Proves: page 1 is the server's default size with no cursor sent;
 * `fetchNextPage` sends the server's opaque `next_cursor` and appends page 2
 * with no repeat; `hasNextPage` follows `has_more` and is false at exactly
 * the default size.
 */
import React from "react";
import express from "express";
import request from "supertest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../../../tests/helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };
const requestedPaths: string[] = [];

vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

// The client transport forwards to the real router over supertest.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: async (
    url: string,
  ): Promise<{ json: () => Promise<unknown> }> => {
    requestedPaths.push(url);
    const res = await request(makeApp()).get(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return { json: async () => res.body as unknown };
  },
}));

import tutorRuntimeRouter from "../../../server/routes/tutor-runtime";
import { useConversations } from "./tutor-client";

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  return app;
}

function wrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function seed(n: number): void {
  for (let i = 0; i < n; i += 1) {
    db.current.seed("tutor_conversations", {
      student_id: STUDENT_ID,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      status: "active",
      updated_at: new Date(Date.UTC(2026, 8, 1, 10, i)).toISOString(),
    });
  }
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  requestedPaths.length = 0;
});

describe("useConversations ↔ GET /api/tutor/conversations (cursor pages)", () => {
  it("21 conversations: 20, then the 21st via the server's cursor, no repeat", async () => {
    seed(21);
    const { result } = renderHook(() => useConversations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.conversations).toHaveLength(20);
    expect(result.current.hasNextPage).toBe(true);
    expect(requestedPaths[0]).not.toContain("cursor=");

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.conversations).toHaveLength(21),
    );
    const ids = (result.current.data?.conversations ?? []).map(
      (c) => c.conversation_id,
    );
    expect(new Set(ids).size).toBe(21);
    expect(requestedPaths[1]).toContain("cursor=");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("exactly 20: one page, hasNextPage false", async () => {
    seed(20);
    const { result } = renderHook(() => useConversations(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.conversations).toHaveLength(20);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("empty: no rows, hasNextPage false", async () => {
    const { result } = renderHook(() => useConversations(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.conversations).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
