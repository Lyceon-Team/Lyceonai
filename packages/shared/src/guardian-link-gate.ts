/**
 * @spec [Guardian_Closure_Plan G2-04; owner ruling R6 (2026-09-27); SCL-187 rule 1]
 * | @implemented [2026-09-29]
 *
 * plain English: the code every refusal of the under-13 link gate carries. An under-13 student
 * with no ACTIVE guardian link gets 403 with this code on every learning endpoint; the client reads
 * it to send the student to the linking page. One definition, server and client.
 */
export const GUARDIAN_LINK_REQUIRED = "GUARDIAN_LINK_REQUIRED" as const;

/**
 * @spec [Guardian_Closure_Plan G2-06 (G-NEW-09); owner ruling 2026-09-29] | @implemented [2026-09-29]
 *
 * plain English: the code a learning endpoint refuses with while the student's age is unknown (no
 * date of birth yet), and the one `requireProfileComplete` already used. The same gate that
 * carries GUARDIAN_LINK_REQUIRED checks it first; the client reads it to send the student to
 * profile completion.
 */
export const PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE" as const;
