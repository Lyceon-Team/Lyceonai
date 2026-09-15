/**
 * @spec [SCL-080 (the code is the credential; entry is normalised — trim, strip inner
 *        whitespace, upper-case); owner brief 2026-09-15 Part B1 (the emailed deep link
 *        prefills the redeem page and changes nothing about redeeming)] | @implemented [2026-09-15]
 *
 * plain English: reads `?code=` off the guardian dashboard's URL so the emailed link lands
 * with the code already in the box. Pure and total: a missing or malformed value yields ""
 * and the guardian types as before. The SERVER's parse still decides validity; this only
 * spares the round trip for whitespace and case, exactly as the manual path does. Bounded so
 * a hostile query string cannot stuff the input.
 */
export const LINK_CODE_QUERY_PARAM = "code";
const MAX_PREFILL_LENGTH = 12;

export function linkCodeFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get(LINK_CODE_QUERY_PARAM) ?? "";
  return raw.replace(/\s+/g, "").toUpperCase().slice(0, MAX_PREFILL_LENGTH);
}
