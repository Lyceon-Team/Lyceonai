-- ---------------------------------------------------------------------------
-- Two more surfaces record consent: guardian link redemption, and checkout.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [LYCEON consent capture §4, §5; Cal. Bus. & Prof. Code § 17602(a)(4)]
-- @implemented 2026-09-16
--
-- plain English: `consent_source` is a CHECK-constrained enum naming WHERE an
-- acceptance was collected. It lists three signup entry points and nothing
-- else, so the guardian-link, checkout and re-consent surfaces cannot write a
-- row at all — the insert is refused by the constraint, not by the application.
-- This widens it by exactly three values and adds one nullable column for the
-- identifier the collecting surface issues.
--
-- The three: `guardian_link_redeem` (a guardian accepting Parent / Guardian
-- Terms while redeeming a student link code), `stripe_checkout` (auto-renewal
-- consent taken in Checkout per § 17602), and `reconsent_prompt` (an existing
-- user accepting a newly published version through the blocking modal). Naming
-- the surface matters: "which of these people agreed at a prompt they could not
-- dismiss" is a question someone will eventually have to answer.
--
-- WHY A COLUMN RATHER THAN OVERLOADING ONE THAT EXISTS. §17602 consent taken at
-- checkout has to be tied back to the transaction it was taken during, which
-- means storing the Stripe Checkout Session id. The nullable columns already
-- present are `user_agent` and `ip_address`; putting a session id in either
-- would make both unreadable and would defeat any later attempt to redact them.
-- `source_reference` is what the surface named in `consent_source` issued:
-- a `cs_...` session id for stripe_checkout, NULL for the signup forms, which
-- issue nothing.
--
-- WHAT THIS DOES NOT ADD. `actor_type` is untouched. The guardian surface
-- records `'parent'`, the value that already exists for exactly this actor and
-- that `LegalAcceptanceRecord` already types. Adding a second value meaning the
-- same thing would make "how many guardians consented" a two-part question
-- forever, for no gain — there are zero rows of either today, so the cheap
-- moment to NOT create that split is now.
--
-- IDEMPOTENT. Re-running drops and recreates the CHECK rather than assuming it
-- is absent, and the column add is IF NOT EXISTS. Applying twice is a no-op.
--
-- trade-offs / edge cases:
--   - `source_reference` is nullable and unconstrained in shape. A session id,
--     a future surface's own identifier, or nothing. Constraining it to `cs_%`
--     would bind the column to Stripe, which is one surface out of four.
--   - The 24 existing rows are untouched. They carry consent_source values that
--     remain valid; nothing about them changes.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_consent_source_check;

ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_consent_source_check
  CHECK (consent_source IN (
    'email_signup_form',
    'google_continue_pre_oauth',
    'google_continue_click',
    'guardian_link_redeem',
    'stripe_checkout',
    'reconsent_prompt'
  ));

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS source_reference text;

COMMENT ON COLUMN public.legal_acceptances.source_reference IS
  'Identifier issued by the surface named in consent_source. A Stripe Checkout '
  'Session id (cs_...) for stripe_checkout; NULL for surfaces that issue none.';

COMMENT ON CONSTRAINT legal_acceptances_consent_source_check ON public.legal_acceptances IS
  'Where the acceptance was collected. guardian_link_redeem: a guardian '
  'accepting Parent / Guardian Terms while redeeming a student link code. '
  'stripe_checkout: auto-renewal consent taken in Checkout per Cal. Bus. & '
  'Prof. Code § 17602, separate from Terms of Use acceptance at signup. '
  'reconsent_prompt: an existing user accepting a newly published version '
  'through the blocking modal shown at next sign-in.';

COMMIT;

-- DOWN (not applied; recorded so the change is reversible by hand)
-- BEGIN;
--   ALTER TABLE public.legal_acceptances DROP COLUMN IF EXISTS source_reference;
--   ALTER TABLE public.legal_acceptances
--     DROP CONSTRAINT IF EXISTS legal_acceptances_consent_source_check;
--   ALTER TABLE public.legal_acceptances
--     ADD CONSTRAINT legal_acceptances_consent_source_check
--     CHECK (consent_source IN ('email_signup_form','google_continue_pre_oauth','google_continue_click'));
-- COMMIT;
-- Reversal requires that no row carries a widened value or a source_reference.
