/**
 * The platform error envelope (Coding Standards §8.2).
 *
 * @spec [lyceon-coding-standards §8.2 (consistent response shape), §7.2 (single source in
 *        packages/shared)] | @implemented [2026-10-05]
 *
 * plain English: `{ error: { message, code?, details? } }`, the standard's error envelope. It
 * was first defined in `calendar/api.ts`, because the calendar needed it before any shared
 * definition existed; it lives in its own module so that a consumer which needs only the
 * envelope (the client's error parser, via `entitlement-denial`) does not load every calendar
 * schema with it. `calendar/api.ts` re-exports it, so its existing importers are unchanged.
 */
import { z } from "zod";

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;
