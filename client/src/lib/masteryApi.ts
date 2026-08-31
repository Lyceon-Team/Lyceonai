/**
 * @spec [Doc 05B §10.3 single-route contract; §10.4 empty-list semantics; §10.7 no
 *   pagination; owner ruling 2026-08-20 RULE 1/4/5/6; ruling 2026-08-21 Q2/Q6; owner ruling
 *   2026-08-27 (FLAT /mastery/skills, one fetch, client-side domain filter); Coding
 *   Standards §11.2 (server state through the query layer)] | @implemented [2026-08-27]
 *
 * plain English: the client's view of the mastery drill-down. A student sees a LEVEL and the
 * NAME of that level. There is no score, no percentage and no accuracy on the wire, so there
 * is nothing here to render one from.
 *
 * THE TYPES ARE NO LONGER HAND-WRITTEN. This module used to declare its own
 * `MasteryDomainNode` / `MasterySkillNode` / response interfaces above a DRIFT NOTE saying
 * the client "has no module path to packages/shared" and that the two copies were "kept in
 * step by review". They are now imported. Review is not a mechanism: eleven hand-written
 * client types is what produced `GuardianWeaknessResponse`, which declared `skills` against
 * a route that returned `domains` and crashed the dashboard for every guardian whose student
 * had rows. A type that matches no server response is a wish.
 *
 * ONE FETCHER PER RESOURCE, NOT ONE PER AUDIENCE. `fetchMasteryDomains(studentId)` is called
 * by the student grid with their own id and by the guardian dashboard with the linked
 * student's id. There is no `fetchGuardianDomains` any more, because there is no guardian
 * route any more — under Doc 05B §10.3 the guardian read IS the student query.
 */
import {
  masteryDomainsResponseSchema,
  masterySkillsResponseSchema,
  studentResourceUrl,
  type MasteryDomainNode,
  type MasteryDomainsResponse,
  type MasterySection,
  type MasterySkillNode,
  type MasterySkillsResponse,
  type MasteryLevelKey,
} from "@lyceon/shared/student-resources";
import { apiRequest } from "./queryClient";

export type {
  MasteryLevelKey,
  MasteryDomainNode,
  MasteryDomainsResponse,
  MasterySection,
  MasterySkillNode,
  MasterySkillsResponse,
};

/**
 * Parses the body against the shared schema before it reaches a component.
 *
 * A malformed 200 is a REJECTED promise, never a defaulted empty object. The query layer
 * then renders it as a recoverable error rather than as "this student has no mastery data" —
 * the same collapse that told a parent their child had answered nothing. Empty and failed
 * are different answers, and this vertical has produced eleven instances of confusing them.
 */
async function parsed<T>(
  response: Response,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  resource: string,
): Promise<T> {
  const body: unknown = await response.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `${resource}: the server returned a body this client cannot read. This is a contract mismatch, not an empty result.`,
    );
  }
  return result.data;
}

/**
 * Domain grid for ONE student — their own, or a linked student's. Both callers hit the same
 * route with a different id in the path.
 */
export async function fetchMasteryDomains(
  studentId: string,
): Promise<MasteryDomainsResponse> {
  const response = await apiRequest(
    studentResourceUrl(studentId, "masteryDomains"),
  );
  return parsed(response, masteryDomainsResponseSchema, "mastery/domains");
}

/**
 * EVERY skill, for one student, in ONE fetch. Doc 05B §10.3 names the resource flat and
 * §10.7 bounds it at ~80 rows; the drill-down filters by domain in the component, so opening
 * three domains costs one request rather than three.
 *
 * A guardian caller receives `skills: []` with `catalogEmpty: false` — Doc 05B §10.4's
 * denial-by-absence-of-policy, which is deliberately indistinguishable from a student who
 * has no skill rows yet, and is NOT a 403.
 */
export async function fetchMasterySkills(
  studentId: string,
): Promise<MasterySkillsResponse> {
  const response = await apiRequest(
    studentResourceUrl(studentId, "masterySkills"),
  );
  return parsed(response, masterySkillsResponseSchema, "mastery/skills");
}

/** The skills of one domain, filtered from the flat fetch. No second request. */
export function skillsForDomain(
  skills: readonly MasterySkillNode[],
  section: MasterySection,
  domain: string,
): MasterySkillNode[] {
  return skills.filter(
    (skill) => skill.section === section && skill.domain === domain,
  );
}
