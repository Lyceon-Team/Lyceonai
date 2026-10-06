# Cleanup — Retention Rulings and Follow-Up Work

**Vertical:** `cleanup`. **Source:** the RS-HO establishment (#1117 Part B, merged into `guardian` 2026-10-05) and the owner's cleanup-retention brief of 2026-10-05.
**Production counts** behind the rulings (owner, read-only, 2026-10-05):

| Check | Production |
|---|---|
| Under-13 accounts (by date of birth) | 3; 2 of them have had no guardian link for over 30 days (the stuck March accounts) |
| Stale under-13 flag | 0 |
| Under-13 accounts with a PostHog ID | 0 |
| Accounts inactive for 12 months | 0 |
| `auth.users.last_sign_in_at` | filled for all but 3 accounts |
| `profiles.last_login_at` | never written |
| Guardian-link consent rows in `audit_logs` | 21, all younger than a year |
| Pending deletion requests | 1 (`2bcd0fa8`, 13+, scheduled 2026-10-08 04:18 UTC); 1 cancelled |

## Rows (this PR)

| Row | What | Status |
|---|---|---|
| C-00 | Deletion mode before the next deletion runs | **CLOSED — owner ruling 2026-10-05: (a) anonymise; W7 and W9 closed** (see below). No code: the driver already anonymises. |
| C-01 | Crisis-flagged transcripts survive account deletion, de-linked | BUILT, SCL-216 PROPOSED. Migration `20261027000001` OWNER-RUN |
| C-02 | Guardian-link consent rows are never purged | BUILT, SCL-215 PROPOSED. Migration `20261027000000` OWNER-RUN |
| C-03 | Retire `idempotency_records` / `idempotency_runtime_config`, `service_auth_secrets` + HMAC code, `profiles.last_login_at`; CI check for emails in audit `changes` | BUILT, SCL-217 PROPOSED. Migration `20261027000002` OWNER-RUN |
| C-04 | This plan entry | DONE |

### C-00 — W7 and W9 are closed (owner ruling 2026-10-05)

**Ruling:** reading (a). User-facing account deletion anonymises, as built: the driver passes `anonymize` (`server/lib/account-deletion-execute.ts:166-176`). Request `2bcd0fa8` (aged 13 or over) runs as anonymise at the 2026-10-09 02:00 UTC executor run. Nothing is switched off.

**W7 and W9 are closed.** They were given in substance by the counsel ruling and were never marked closed against RB-07E-V1-01. The evidence:

- **W9 (legal counsel sign-off): Doc 05E** (LOCKED) has the header "**Counsel:** Mechanism approved — decoupled synthetic actor identifier, … identity-linkage destroyed at deletion". §1 says "The user-facing account-deletion action invokes the **anonymize** disposition. **Hard-delete** … is retained as a `service_role`-only internal tool". §8 step 5 says the same.
- **W9: SCL-009** (2026-06-25) records "Counsel approved the mechanism".
- **W9: SCL-012** (2026-06-27) records "The INTERNAL mechanism remains anonymize-retain (Doc 05E governs; cascade 'anonymize' mode)".
- **W7 (privacy policy publication):** the published Privacy Policy discloses anonymised retention (PP lines 13, 33, 82, 253), which is the disclosure 07E FWD-07E-05 asks for.

**07E:29 is stale on this point.** It says the Doc 05D fallback hard delete stays "until W7 + W9 close". With W7 and W9 closed, 05D §10.4's anonymised-retention path is the production path, as 05E requires. 07E:29's other clause still stands: "under-13 fallback hard-delete is mandatory regardless of W7/W9 status". That is the under-13 mode ruling below.

## Rulings recorded for the later build (owner, 2026-10-05) — NOT built here

### Under-13 deletion (Q1–5)

- **Mode.** Any deletion of an under-13 account is a hard delete. The rule does not delete accounts at signup. This is consistent with 07E:29: "under-13 fallback hard-delete is mandatory regardless of W7/W9 status".
- **Triggers. Owner ruling 2026-10-05, revised the same day to follow counsel's GAP-HY-14 resolution:**
  - **Guardian revoke.** When the last active guardian link is revoked, that counts as consent revocation (D01 §37.5). It starts the standard 7-day deletion path (D01 §40.2–§40.5), with its restore window, and then hard-deletes. This follows the counsel resolution in `docs/SpecAudit/10-gap-registry/gap-registry.md:143` (GAP-HY-14): "**Counsel resolution (2026-06-20): under-13 follows the standard 7-day deletion path — there is NO accelerated/'immediate' branch**". It agrees with D01:1795 ("Revoking consent will delete this student's account after 7 days. Proceed?"). It supersedes D01:2002-2003's "without the 7-day grace period … immediate deletion"; GAP-HY-14 records that §40.6 edit as pending owner-apply.
  - **Never linked.** An account with no active guardian link 30 days after signup is deleted (D01 §37.4 expiry, D01:1786 `consent_expiration_deletion_days`, "default 30 days total from signup"). This is a separate timer, as GAP-HY-14 keeps it.
  - **Why the earlier 30-day revoke clock is withdrawn.** It was meant to make an accidental revoke recoverable. The standard 7-day path's restore window already does that, so the extra clock adds nothing.
- **Age.** Taken from `date_of_birth` at execution time, not the stored `is_under_13` flag. The flag is recomputed only when the date of birth is written, so it goes stale at the 13th birthday.
- **Who qualifies today.** The 2 under-13 accounts with no link for over 30 days would qualify when this is built.
- **Engine.** The existing account-deletion cascade, with a system-initiated request and a per-request mode. Today the only entry point is self-serve `POST /delete`, and the driver hardcodes `anonymize` (`server/lib/account-deletion-execute.ts:166-176`).

### Inactivity (Q7–10)

- **Activity signal.** The later of `auth.users.last_sign_in_at` and the student's latest learning event (practice, review, exam or LISA), falling back to `created_at`. PP:462 counts all of these as activity. `profiles.last_login_at` is dropped (C-03).
- **Verify first.** Check whether Supabase updates `last_sign_in_at` on token refresh or only on sign-in. 07E:532 claims refresh; if it is sign-in only, a student who stays signed in would look inactive on that signal alone. Status: UNKNOWN.
- **Guardians.** A guardian with an active, paid, linked student is never inactivity-deleted.
- **The 48-hour notice** (07E:540) goes to the student and their guardian by email. The owner writes the copy.
- **Deadline.** `JOB-INACTIVITY-DETECTION` by 2027-02-26 (07E:941).

### Other rulings

- **Q11.** Doc 03 §14.2's 90 days governs instruction assignments and exposures (D03:1252, 1254), as built in the 90d tier. Rows held for crisis-flagged conversations are intentional (RS-00).
- **Q12.** The 365d tier stays a stub returning `365d_tables_not_provisioned`. Its rows (LISA cost telemetry, quota appeal records, D03:1257-1258) remain in the spec. Striking them needs a spec amendment, so this is a note only. `tutor_turn_metrics` stays at 90 days.
- **Q18.** When the exam audit tables (Doc 04D) exist, account deletion removes the student link from them.
- **Q19.** The PostHog `bulk_delete` step (07E:612-677) belongs to `cleanup`. Production has 0 under-13 accounts with a PostHog ID.
- **Q20.** FERPA rulings wait until school accounts exist. Rules 1, 5, 9, 10 and 11 would differ for school-provisioned accounts (07E:1158).

## Counsel backlog (no legal text edited)

| Item | Source | Owner | Status |
|---|---|---|---|
| The Privacy Policy's under-13 hard-deletion list names "LISA conversation data" (PP:477, 481). Crisis-flagged transcripts now survive account deletion de-linked (C-01, SCL-216), and crisis data outranks that line. In practice no under-13 LISA rows exist, because LISA is blocked for under-13. | C-01 | Karl / counsel | COUNSEL-APPROVED 2026-10-05 — applied in Privacy Policy v5 (#1128, SCL-219) |
| The Privacy Policy does not disclose the 48-hour inactivity notice, which 07E:477 says it must ("you will receive notification 48 hours before deletion"). | Q9 | Karl / counsel | COUNSEL-APPROVED 2026-10-05 — applied in Privacy Policy v5 (#1128, SCL-219) |
| Under-13 revoke trigger: the owner's 30-day-clock ruling against counsel's 2026-06-20 GAP-HY-14 resolution (standard 7-day path). | Q1–5 | Karl / counsel | OPEN |
