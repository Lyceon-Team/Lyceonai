import { z } from "zod";

/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23; Coding Standards §6.1, §7.2]
 * | @implemented [2026-09-29]
 *
 * plain English: the roles the application understands. `profiles.role` is a wider enum
 * (it also carries 'tutor' and 'teacher'), so a role read from the database is PARSED against
 * this schema, never assumed. A value outside it is not "probably a student": the session is
 * refused with `ROLE_UNRECOGNIZED` and nothing about the account is rewritten.
 *
 * ONE definition, consumed by the server (session load, role gates, billing) and the client
 * (route guard, error screen), so the two cannot disagree about which roles exist.
 */
export const runtimeRoleSchema = z.enum(["student", "guardian", "admin"]);
export type RuntimeRole = z.infer<typeof runtimeRoleSchema>;

/** The error code every refusal of an unrecognised role carries, server and client. */
export const ROLE_UNRECOGNIZED = "ROLE_UNRECOGNIZED" as const;
