-- W3-3 — country backfill. OWNER-RUN. Nothing here is applied by CI or code.
-- @spec [Doc-03_V3 §4.6, §12.3; INV-03-08; closure plan W3-3 §3.3]
--
-- The billing country is held by Stripe, not by us: stripe_webhook_events
-- stores event ids only. So the fill is: export (Q1) -> read Stripe with
-- scripts/ops/backfill-country-code.ts, which PRINTS the UPDATEs -> apply that
-- output -> count (Q2).
--
-- BLANK = null, '' or whitespace-only (`NULLIF(btrim(country_code), '') IS
-- NULL`). Production holds at least one `country_code = ''` (2026-09-26), from
-- an out-of-band write: no application path writes one. Every query below and
-- every UPDATE the script prints treats blank as "no country", so that row is
-- exported and filled like a null one. `country_blank_string` in Q0 counts the
-- non-null blanks separately so they are visible.

-- Q0 — the population, before. Students with an entitlement, how many are
-- paid through Stripe, and how many already have a country.
SELECT
  count(*)                                                    AS entitled_premium,
  count(*) FILTER (WHERE e.stripe_subscription_id IS NOT NULL) AS with_stripe_subscription,
  count(*) FILTER (WHERE NULLIF(btrim(p.country_code), '') IS NOT NULL) AS country_known,
  count(*) FILTER (WHERE NULLIF(btrim(p.country_code), '') IS NULL)     AS country_blank,
  count(*) FILTER (WHERE p.country_code IS NOT NULL
                     AND btrim(p.country_code) = '')                    AS country_blank_string
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium';

-- Q1 — the export the script reads (save as JSON). Premium students with a
-- Stripe subscription and no country yet (null, '' or whitespace).
SELECT e.profile_id, e.stripe_subscription_id
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium'
  AND e.stripe_subscription_id IS NOT NULL
  AND NULLIF(btrim(p.country_code), '') IS NULL
ORDER BY e.profile_id;

-- (run the script; apply the UPDATEs it prints — each is guarded by
--  `AND (country_code IS NULL OR btrim(country_code) = '')`, so it fills a
--  blank row and never overwrites a live-path value)

-- Q2 — after: how many got a country, how many remain blank, and by country.
SELECT
  count(*) FILTER (WHERE NULLIF(btrim(p.country_code), '') IS NOT NULL) AS country_known,
  count(*) FILTER (WHERE NULLIF(btrim(p.country_code), '') IS NULL)     AS country_blank
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium';

SELECT coalesce(NULLIF(btrim(p.country_code), ''), '(blank)') AS country,
       count(*) AS students
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium'
GROUP BY 1
ORDER BY 2 DESC;

-- Q3 — every profile (not only premium) whose country_code a
-- null-or-two-uppercase-letters CHECK would reject. Read-only. Run before any
-- decision on the constraint: it must return zero rows (or be cleaned) before
-- such a CHECK can be validated.
SELECT
  CASE WHEN btrim(p.country_code) = '' THEN '(blank string)'
       ELSE p.country_code END AS value,
  length(p.country_code)       AS len,
  count(*)                     AS profiles
FROM public.profiles p
WHERE p.country_code IS NOT NULL
  AND p.country_code !~ '^[A-Z]{2}$'
GROUP BY 1, 2
ORDER BY 3 DESC;

-- Finding a student from the crisis WARN (`crisis_country_defaulted`): the
-- logger digests every uuid to the first 8 hex of its sha256.
-- SELECT id FROM public.profiles
-- WHERE left(encode(sha256(id::text::bytea), 'hex'), 8) = '<digest from the log>';
