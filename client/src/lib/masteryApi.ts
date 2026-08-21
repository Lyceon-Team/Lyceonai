import { apiRequest } from "./queryClient";

/**
 * @spec [owner ruling 2026-08-20 RULE 1 (the six level names), RULE 4 (nine columns never
 *   exposed), RULE 5 (drill-down: domain first, then skills), RULE 6 (NULL is its own
 *   state); ruling 2026-08-21 Q2 (skill names render verbatim), Q6 (catalogEmpty is a
 *   distinct state from a failed read); Coding Standards §11.2 (server state through the
 *   query layer, never ad-hoc fetch in a component)] | @implemented [2026-08-21]
 *
 * plain English: the client's view of the mastery drill-down. A student sees a LEVEL and
 * the NAME of that level. There is no score, no percentage and no accuracy on the wire, so
 * there is nothing here to render one from.
 *
 * DRIFT NOTE. These types mirror `packages/shared/src/mastery-levels.ts`. The client has no
 * module path to `packages/shared` (same constraint documented in `projectionApi.ts`), so
 * the two are kept in step by review and by the server-side contract tests rather than by a
 * shared import. Do NOT add a numeric field here: if one appears on the wire, the fix is on
 * the server, because `tests/ci/mastery.anti-leak.ci.test.ts` pins the exact key set of
 * every node and would already be red.
 *
 * `displayName` is the string the DATABASE holds (`mastery_levels.display_name`). The client
 * never maps a level to a name — that mapping is a locked owner ruling living in one table,
 * and a second copy here is how "Foundations" would quietly become something else.
 */

export type MasteryLevelKey = "unmeasured" | "L0" | "L1" | "L2" | "L3" | "L4";

export type MasterySection = "M" | "RW";

export interface MasteryDomainNode {
  section: MasterySection;
  domain: string;
  levelKey: MasteryLevelKey;
  /** The integer the formula emitted, or null for the unmeasured state. NULL is not zero. */
  level: number | null;
  displayName: string;
}

export interface MasterySkillNode {
  /** The canonical database string, rendered verbatim (owner ruling 2026-08-21 Q2). */
  skill: string;
  levelKey: MasteryLevelKey;
  level: number | null;
  displayName: string;
}

export interface MasteryDomainsResponse {
  ok: true;
  domains: MasteryDomainNode[];
}

export interface MasterySkillsResponse {
  ok: true;
  section: MasterySection;
  domain: string;
  /**
   * True only when the question bank publishes nothing for this domain. A FAILED read is a
   * rejected promise, never this flag — the two must not render the same way.
   */
  catalogEmpty: boolean;
  skills: MasterySkillNode[];
}

export async function fetchMasteryDomains(): Promise<MasteryDomainsResponse> {
  const response = await apiRequest("/api/me/mastery/domains");
  return response.json();
}

export async function fetchMasterySkills(
  section: MasterySection,
  domain: string,
): Promise<MasterySkillsResponse> {
  // Canonical domains contain spaces ("Problem Solving and Data Analysis"), so the segment
  // is encoded rather than interpolated raw.
  const response = await apiRequest(
    `/api/me/mastery/domains/${encodeURIComponent(section)}/${encodeURIComponent(domain)}/skills`,
  );
  return response.json();
}
