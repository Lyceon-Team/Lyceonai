/**
 * @spec [Doc 05B §10.3 single-route contract + path-layer authorization
 *   ("Unrelated authenticated users get 404, not 403 — this avoids leaking
 *   whether the student_id exists"), RB-05B-V1-05 ("route handlers MUST NOT
 *   branch into different SQL predicates or projections by caller role. A single
 *   path-layer authorization check ... is the only permitted role-aware branch");
 *   Doc 05C §10.2; Doc 01 V8 §35/§38.1; owner rulings 2026-08-26 R3/R5/R6 and
 *   2026-08-27 OQ1/OQ5] | @implemented [2026-08-27]
 *
 * plain English: THE chokepoint. It turns the PRINCIPAL (who is calling) into the
 * SUBJECT (whose data this is) and puts the answer on `req.subject`. Self and
 * guardian are two branches of ONE resolver, not two routes. Below this
 * middleware no handler learns the caller's role — that is enforced mechanically
 * by scripts/ci/subject-resolver-chokepoint-gate.mjs, not by convention.
 *
 * WHY A CHOKEPOINT AT ALL. Three privilege divergences were found in this
 * vertical, each by collapsing two independently-written paths onto one: a
 * hardcoded `includeHistoricalTrends = true` that let a guardian see a premium
 * surface the student's own entitlement denied (#644); a `reportAvailable` with
 * no entitlement term at all (#645); and a metric allowlist that stripped an
 * entitlement-granted metric back out, so the guardian of a PAYING student saw
 * less than the student. Three for three. While two code paths serve one
 * resource, a fourth instance is not a risk, it is a schedule.
 *
 * STATUS CODES, AND THE ONE DELIBERATE DEVIATION.
 *   400 — `studentId` is not a uuid. Cannot name a real row, so no enumeration
 *         surface; saying "malformed" leaks nothing about existence.
 *   404 — `not_linked`. Per §10.3. A 403 would confirm the student exists.
 *   402 — `student_unentitled`. THIS IS AN EXPLICIT, RULED DEVIATION from
 *         "404 globally" (owner ruling 2026-08-27, OQ1). Reaching it requires
 *         already being linked to the student, so it discloses nothing the caller
 *         does not know; and collapsing it into 404 would silently delete the
 *         paywall path the guardian upgrade flow depends on, after which the
 *         distinction would be reinvented in TypeScript — a second derivation.
 *         DO NOT "correct" this back to a uniform 404 without a new ruling.
 *
 * NO ADMIN BYPASS, AND IT IS NOT COMING BACK (owner ruling 2026-08-26 R5).
 *   The middleware this replaces let any admin skip both the link check and the
 *   entitlement check. At scale that is every operator able to read every
 *   student's mastery, KPI and projections with no link, no entitlement, and no
 *   record — a standing privacy exposure on a platform for 13-18 year olds whose
 *   moat is guardian trust, bought for debugging convenience. NON-GOAL, recorded
 *   so it is not reinvented under pressure: if support ever needs per-student
 *   visibility it is a student- or guardian-initiated, time-boxed, audited GRANT
 *   that the subject can revoke — never a role bypass, which is unrevocable,
 *   unbounded, and invisible to the family it concerns.
 */
import type { NextFunction, Request, Response } from "express";
import {
  studentIdParamSchema,
  type Subject,
} from "../../packages/shared/src/guardian-subject";
import { resolveGuardianViewDecision } from "../services/guardian-subject";
import { recordSubjectAccess } from "../services/subject-access-audit";
import { requireRequestUser } from "./supabase-auth";

declare global {
  namespace Express {
    interface Request {
      subject?: Subject;
    }
  }
}

/**
 * Denials are byte-identical for "no such student" and "student exists, you are
 * unrelated to them". Two different bodies would re-open the enumeration channel
 * that returning 404 closed.
 *
 * EXPORTED, not copied. The link routes on this same mount deny for a third reason
 * — "you are not a party to this link" (owner ruling 2026-08-27 Q7) — and a second
 * hand-written 404 body would make the three distinguishable by their bytes, which
 * is exactly the channel this function exists to close. One definition, one shape.
 */
export function sendNotFound(res: Response, requestId?: string) {
  return res.status(404).json({
    error: "Not found",
    message: "No such student, or you do not have access to them",
    requestId,
  });
}

export async function resolveSubject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = req.requestId;

  const user = requireRequestUser(req, res);
  if (!user) {
    return;
  }

  const parsed = studentIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: "Invalid student id", details: parsed.error.flatten() },
      requestId,
    });
    return;
  }
  const { studentId } = parsed.data;

  // SELF. No link lookup, no entitlement term, and no audit record: a student
  // reading their own dashboard is not a guardian-boundary event, and recording
  // every one of them would bury the accesses that matter in noise
  // (owner ruling 2026-08-27, OQ5).
  if (user.id === studentId) {
    req.subject = { studentId, via: "self" };
    next();
    return;
  }

  const decision = await resolveGuardianViewDecision(
    user.id,
    studentId,
    requestId,
  );

  // Every non-self resolution is recorded, GRANTED OR DENIED. A denied guardian
  // access attempt is precisely the thing an access log exists to reconstruct.
  const recorded = await recordSubjectAccess({
    principalId: user.id,
    studentId,
    decision,
    resource: req.baseUrl + req.path,
    requestId,
  });

  if (decision !== "allow") {
    if (decision === "student_unentitled") {
      res.status(402).json({
        error: "Subscription required",
        code: "PAYMENT_REQUIRED",
        message:
          "This student's subscription is not active. Renew it to see their progress.",
        requestId,
      });
      return;
    }
    sendNotFound(res, requestId);
    return;
  }

  // FAIL CLOSED ON AN UNRECORDED ACCESS. If the access log could not be written,
  // the access does not happen. An operator reconstructing who read a child's
  // data months from now cannot distinguish "nobody did" from "the write failed",
  // and on this surface that difference is the whole point of the record.
  // See owner question 1 — this trades availability for auditability, and the
  // opposite choice is one line.
  if (!recorded) {
    res.status(500).json({
      error: "Internal server error",
      message: "Access could not be recorded",
      requestId,
    });
    return;
  }

  req.subject = { studentId, via: "guardian" };
  next();
}
