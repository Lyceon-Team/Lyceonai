/**
 * Moved here from `pages/home.tsx` on 2026-11-22 (owner brief "/parent page") so the homepage
 * and `/parent` advertise one number from one line, rather than each restating it. The
 * reasoning below is unchanged from where it was written.
 */
/**
 * The free-tier daily practice allowance, as advertised.
 *
 * @spec [Doc 02B (V4) "12. Entitlement Gate System" -> "Entitlement Matrix"
 *        and "Quota Contract": "Free users may submit up to
 *        `practice_runtime_config.daily_quota_free` practice questions per
 *        calendar day (40 at launch)"] | @implemented [2026-09-03]
 *
 * THE SOURCE OF TRUTH IS THE DATABASE, NOT THIS LINE.
 * `practice_runtime_config.daily_quota_free` is what the runtime enforces, and
 * it reads 40 in production (verified 2026-09-03). This page is served to
 * logged-out visitors, so it cannot read an authenticated config endpoint; the
 * number is therefore restated here, which is a drift risk and is named as one.
 * Changing the config without changing this line makes the homepage lie again —
 * the defect this replaces. Reported to the owner as a follow-up: a public
 * free-tier endpoint would close it properly. F13: the free card AND the Question of the
 * Day's "Try 40 more questions free" button both read this one constant.
 *
 * Doc 01A Appendix A.3's example bucket map carries a THIRD number for this
 * ("practice_daily_free": 20) against a bucket that exists in neither
 * production nor Doc 02B. That divergence is reported, not resolved here.
 */
export const FREE_DAILY_PRACTICE_QUESTIONS = 40;
