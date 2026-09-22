/**
 * Calendar review adapter — launch contract.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §9.3 review adapter (G-08-03);
 *        Doc_05F_formula_sheet.md §8 item 12, §5A fail-open]
 * | @implemented [2026-09-18]
 *
 * THIS FILE IS THE CONTRACT THE REBUILT review ENGINE IS HELD TO.
 *
 * The review engine has not shipped. Its adapter is a stub that fails OPEN, and
 * these are the four contract items asserted against it. When the real engine lands,
 * it must pass this file with `create` SUCCEEDING instead of declining — every other
 * assertion here stays exactly as written.
 *
 * It is a separate file from the other stub's contract on purpose. They share a
 * factory today; if they shared a test, one engine's rebuild could quietly satisfy
 * the other's contract and nobody would notice which one was still a stub
 * (owner ruling, 2026-09-18).
 *
 * The fail-open posture is the point, not an implementation detail. `enabled_block_types`
 * is ["practice"] at launch so the generator emits no review blocks, but a student
 * can still hold one from a hand-edited day, and an adapter that threw would take the
 * whole calendar read down with it.
 */
import { describe, expect, it } from "vitest";
import type { PlanBlock } from "@lyceon/shared";
import { reviewAdapter } from "../../server/services/calendar/adapters/stub";

const BLOCK: PlanBlock = {
  block_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  scheduled_date: "2026-09-18",
  block_type: "review",
  section: null,
  scope: { mode: "queue" },
  target_count: 5,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: null,
  display_ordinal: 1,
  membership_type: "created",
};

const CTX = {
  student_id: "11111111-1111-1111-1111-111111111111",
  actor_id: "11111111-1111-1111-1111-111111111111",
  role: "student",
  client_instance_id: "ci-abc",
  platform: "web" as const,
  idempotency_key: "calendar:block:7c9e6679-7425-40de-944b-e07fc1f90ae7:1",
};

describe("review adapter — the §9.1 contract", () => {
  it("(1) names its engine, and the name is the block type", () => {
    expect(reviewAdapter.engine).toBe("review");
    expect(reviewAdapter.engine).toBe(BLOCK.block_type);
  });

  it("(2) create declines as DATA — never a throw, never a 500", async () => {
    const result = await reviewAdapter.create(BLOCK, 1, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("engine_unavailable");
  });

  it("(2b) create rejects nothing and resolves — a throw here breaks the launch route", async () => {
    await expect(reviewAdapter.create(BLOCK, 1, CTX)).resolves.toBeDefined();
  });

  it("(3) activityUnits returns none, so blocks read 0 / target rather than as an error", async () => {
    await expect(
      reviewAdapter.activityUnits(CTX.student_id, "2026-09-18", "America/Chicago"),
    ).resolves.toEqual([]);
  });

  it("(4) progress reports no lifecycle, which keeps the block out of in_progress (§13)", async () => {
    await expect(reviewAdapter.progress("any-session-id")).resolves.toBeNull();
  });

  it("(5) nextLaunchSize answers for work still outstanding, and never zero", async () => {
    await expect(reviewAdapter.nextLaunchSize(BLOCK, 7)).resolves.toBe(7);
    await expect(reviewAdapter.nextLaunchSize(BLOCK, 0)).resolves.toBe(1);
  });

  it("declines every size the same way — the refusal is about the engine, not the ask", async () => {
    for (const size of [1, 5, 30]) {
      const result = await reviewAdapter.create(BLOCK, size, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("engine_unavailable");
    }
  });
});
