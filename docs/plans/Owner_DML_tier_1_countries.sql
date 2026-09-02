-- OWNER DML — seed the Tier-1 country list. NOT a migration. Apply in the SQL console.
--
-- @spec [Doc 03 Part XI Invariant Registry, INV-03-08 — heading verified
--        "# **Part XI — Invariants**" -> "## **Invariant Registry**";
--        SCL-046 as amended 2026-08-27]
-- Prepared 2026-08-27. Owner applies; agents do not.
--
-- ============================================================================
-- WHY THIS IS DML AND NOT A MIGRATION
-- ============================================================================
-- This is configuration, not schema. `entitlement_runtime_config` exists so the
-- Tier-1 list can be changed by an operator without a deploy — putting the list
-- in a migration would defeat the table's purpose and make every future country
-- change a code change.
--
-- ============================================================================
-- UNTIL THIS IS APPLIED, THE COUNTRY GATE IS INERT — AND DENIES
-- ============================================================================
-- `evaluateCountryEligibility` FAILS CLOSED on an absent or empty list: it
-- returns `unknown`, which does NOT block checkout but DOES deny entitlement.
-- There is deliberately no empty-config-means-allow path — an unseeded table is
-- a configuration that has not been made, not a decision that everyone
-- qualifies. So until the owner runs this, the gate is configured but has no
-- list to enforce, and no student can be granted entitlement through the
-- post-Checkout path.
--
-- `entitlement_runtime_config` holds 0 rows in production as of 2026-08-27.
--
-- ============================================================================
-- THE SEVEN VALUES, EACH TRACED TO THE INVARIANT
-- ============================================================================
-- INV-03-08 verbatim (Doc 03:2156):
--
--   "INV-03-08 — Tier 1 country gating. LISA access requires billing address
--    country IN {US, CA, UK, AU, NZ, IE, SG} at V1 launch. The authoritative
--    signal is Stripe billing address, not IP geolocation or self-declared
--    country. Enforced: Doc 03 §12.3, Stripe billing integration. Violation:
--    compliance exposure."
--
--   value  ISO 3166-1 alpha-2  named in INV-03-08's set
--   -----  ------------------  -------------------------
--   US     United States       yes
--   CA     Canada              yes
--   UK     United Kingdom      yes  <-- SEEDED AS `GB`; SEE THE RULING BELOW
--   AU     Australia           yes
--   NZ     New Zealand         yes
--   IE     Ireland             yes
--   SG     Singapore           yes
--
-- SEVEN values, matching the invariant's set exactly. No country is added and
-- none is dropped.
--
-- ---------------------------------------------------------------------------
-- ONE DISCREPANCY, SURFACED AND SINCE RULED ON: `UK`
-- ---------------------------------------------------------------------------
-- INV-03-08 writes `UK`. The ISO 3166-1 alpha-2 code for the United Kingdom is
-- `GB`; `UK` is only exceptionally reserved. Stripe's billing address country
-- is ISO 3166-1 alpha-2, so a UK customer's address arrives as **`GB`**, and a
-- list containing `UK` would not match it — the gate would deny every genuine
-- UK customer.
--
-- OWNER RULING 2026-08-28 — SEEDED AS `GB`, AND THIS IS NOT A SPEC CHANGE.
--
-- The ruling: this is an ENCODING question, not an invariant question.
-- INV-03-08 names countries in PROSE; this config stores MACHINE CODES. Stripe
-- uses ISO 3166-1 alpha-2 throughout, and `GB` is the alpha-2 code for the
-- United Kingdom. `UK` is not an assigned alpha-2 code at all, so a list
-- containing it matches no real customer.
--
-- Therefore no SCL is raised against the invariant, and the invariant's text is
-- untouched. The mapping rule is recorded once in SCL-046 so that nobody
-- re-seeds `UK` by reading the prose and copying it literally:
--
--     the spec names countries; the config stores ISO 3166-1 alpha-2;
--     the mapping between them is the standard one.
--
-- NO UK-TO-GB MAPPING EXISTS IN CODE, deliberately. A normalisation layer that
-- silently translates a wrong code is how the NEXT wrong code survives. The
-- config holds correct codes; `evaluateCountryEligibility` only trims and
-- uppercases.
-- ============================================================================

INSERT INTO public.entitlement_runtime_config
  (key, value, value_type, owner, description, environment)
VALUES (
  'tier_1_countries',
  -- Order is the invariant's order, not sorted — so a reader can diff this
  -- against Doc 03:2156 by eye.
  '["US","CA","GB","AU","NZ","IE","SG"]'::jsonb,
  'array',
  'platform',
  'INV-03-08 Tier 1 country gating: the billing-address countries permitted to '
    'hold premium at V1 launch. Read by evaluateCountryEligibility '
    '(server/lib/stripe/country-eligibility.ts). An absent or empty list FAILS '
    'CLOSED — it denies entitlement rather than admitting everyone. NOTE: '
    'INV-03-08 spells the United Kingdom `UK` in prose; this config stores ISO '
    '3166-1 alpha-2, in which the code is `GB`. Owner ruling 2026-08-28: an '
    'encoding question, not a spec change. See SCL-046.',
  'all'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY — run after applying. Expect exactly one row, seven values.
-- ============================================================================
SELECT
  key,
  value,
  value_type,
  jsonb_array_length(value) AS country_count,
  environment
FROM public.entitlement_runtime_config
WHERE key = 'tier_1_countries';

-- Expected:
--   key               | tier_1_countries
--   value             | ["US", "CA", "GB", "AU", "NZ", "IE", "SG"]
--   value_type        | array
--   country_count     | 7
--   environment       | all
