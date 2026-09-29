/**
 * @spec [Guardian_Closure_Plan G2-04; owner ruling R6 (2026-09-27); SCL-187 rule 1]
 * | @implemented [2026-09-29]
 *
 * plain English: the code every refusal of the under-13 link gate carries. An under-13 student
 * with no ACTIVE guardian link gets 403 with this code on every learning endpoint; the client reads
 * it to send the student to the linking page. One definition, server and client.
 */
export const GUARDIAN_LINK_REQUIRED = "GUARDIAN_LINK_REQUIRED" as const;
