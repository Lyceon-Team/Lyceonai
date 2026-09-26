-- W3-3 — country backfill. OWNER-RUN. Nothing here is applied by CI or code.
-- @spec [Doc-03_V3 §4.6, §12.3; INV-03-08; closure plan W3-3 §3.3]
--
-- The billing country is held by Stripe, not by us: stripe_webhook_events
-- stores event ids only. So the fill is: export (Q1) -> read Stripe with
-- scripts/ops/backfill-country-code.ts, which PRINTS the UPDATEs -> apply that
-- output -> count (Q2).

-- Q0 — the population, before. Students with an entitlement, how many are
-- paid through Stripe, and how many already have a country.
SELECT
  count(*)                                                    AS entitled_premium,
  count(*) FILTER (WHERE e.stripe_subscription_id IS NOT NULL) AS with_stripe_subscription,
  count(*) FILTER (WHERE p.country_code IS NOT NULL)          AS country_known,
  count(*) FILTER (WHERE p.country_code IS NULL)              AS country_null
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium';

-- Q1 — the export the script reads (save as JSON). Premium students with a
-- Stripe subscription and no country yet.
SELECT e.profile_id, e.stripe_subscription_id
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium'
  AND e.stripe_subscription_id IS NOT NULL
  AND p.country_code IS NULL
ORDER BY e.profile_id;

-- (run the script; apply the UPDATEs it prints — each is guarded by
--  `AND country_code IS NULL`, so it never overwrites a live-path value)

-- Q2 — after: how many got a country, how many remain null, and by country.
SELECT
  count(*) FILTER (WHERE p.country_code IS NOT NULL) AS country_known,
  count(*) FILTER (WHERE p.country_code IS NULL)     AS country_null
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium';

SELECT coalesce(p.country_code, '(null)') AS country, count(*) AS students
FROM public.entitlements e
JOIN public.profiles p ON p.id = e.profile_id
WHERE e.tier = 'premium'
GROUP BY 1
ORDER BY 2 DESC;

-- Finding a student from the crisis WARN (`crisis_country_defaulted`): the
-- logger digests every uuid to the first 8 hex of its sha256.
-- SELECT id FROM public.profiles
-- WHERE left(encode(sha256(id::text::bytea), 'hex'), 8) = '<digest from the log>';
