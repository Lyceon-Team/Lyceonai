/**
 * @spec [Doc-04A_V2.2, §5.1 test_forms (`name`; forms are immutable once published)]
 *       [Owner ruling, Karl, 2026-10-05: "Form names: display \"Full-Length Test 1/2/3\" in
 *        student UI as a display mapping only. Do not rename test_forms rows (forms are
 *        immutable)."]
 * @implemented [2026-10-05]
 *
 * plain English: the one place a full-length form's stored name becomes the name a student
 * reads. `test_forms.name` stays what it is; every student surface that prints a form name
 * passes it through `displayFormName` at render time.
 *
 * expected outcome: "Practice Test 2" (what the CI gates and fixtures store) and
 * "Full-Length Practice Test 2" (what the E5 seed, scripts/exam-forms/form_001_003.sql:699-701,
 * stores) both read "Full-Length Test 2".
 *
 * trade-offs: presentation only. API payloads, DB rows, keys, sorting and identifiers keep the
 * stored value; a test or lookup keyed on the name keeps working. Guardian surfaces do not call
 * this yet (the guardian vertical adopts the ruling later).
 *
 * edge cases: the match is exact and case-sensitive over the whole string — no trimming, no
 * case folding. Anything else (a future form name, "practice test 1", " Practice Test 1",
 * "Practice Test 1A", "Practice Test") passes through unchanged, so a name this function was not
 * written for is never mangled. N is one or more ASCII digits and is kept as stored ("Practice
 * Test 12" → "Full-Length Test 12").
 */

/** The stored shapes the ruling renames: optional "Full-Length " prefix, then "Practice Test N". */
const STORED_FORM_NAME = /^(?:Full-Length )?Practice Test ([0-9]+)$/;

/** The student-facing name of a full-length form. Pure and total. */
export function displayFormName(storedName: string): string {
  const match = STORED_FORM_NAME.exec(storedName);
  const n = match?.[1];
  return n === undefined ? storedName : `Full-Length Test ${n}`;
}
