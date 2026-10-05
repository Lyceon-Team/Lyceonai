> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Sub-Processor List, proposed version 1 (new; Doc 10 §9.18).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served, not linked from the product.
> Source: an inventory of every third party in the code, taken from `seo` at `4f463ee2` on 2026-10-03. Evidence is in the internal column, which is **removed before publication**.

# **LYCEON Sub-Processors**

These are the service providers that process personal information on LYCEON's behalf. Each processes it only on our instructions and only to provide its service to us.

| Provider | Service | Personal information processed | Location |
|---|---|---|---|
| **Supabase** | Database and authentication | Account data, learning data | **[REGION — TO CONFIRM]** |
| **Vercel** | Application hosting, delivery, scheduled jobs | Request and log data, including IP address | **[REGION — TO CONFIRM]** |
| **Stripe** | Payment processing | Payer name, email, billing address, payment method | United States **[TO CONFIRM]** |
| **Google Cloud** | AI services and content safety for the LISA tutor; background processing | Tutor conversation text (students 13 and over only); internal identifiers | United States and other Google Cloud locations **[TO CONFIRM]** |
| **Google** | "Sign in with Google" | Google sign-in details, if the user chooses it | United States **[TO CONFIRM]** |
| **Resend** | Email delivery | Email address, message content | **[REGION — TO CONFIRM]** |
| **Desmos** | Graphing calculator on math questions | Browser technical data (e.g. IP address) when the calculator loads | United States **[TO CONFIRM]** |
| **Slack** | Internal staff alerts | Internal reference numbers only; no conversation content, no names | United States **[TO CONFIRM]** |
| **PostHog** **[Effective when F10/F11 ship]** | Product analytics and session recording | Usage events and page interactions; no names or emails; IP discarded; under-13 excluded | **[EU or US — TO CONFIRM]** |
| **Cloudflare** **[Effective when Q2 ships]** | Abuse protection (Turnstile) | Browser technical data | **[TO CONFIRM]** |

We will update this list before adding a new sub-processor that processes personal information, and note the date.

**Last updated:** [DATE OF PUBLICATION]

---

## Internal evidence (remove before publication)

| Provider | Evidence (file:line) |
|---|---|
| Supabase | `client/src/lib/supabase.ts:1-24`; `server/lib/supabase-ssr.ts`; `server/middleware/supabase-auth.ts` |
| Vercel | `vercel.json` (build, crons, routes); `api/index.ts:1`; IP in logs at `server/logger.ts:1014` |
| Vercel Analytics (to be retired by F10) | `client/src/App.tsx:440`; allow-list in `client/src/lib/analytics-surface.ts` |
| Stripe | `server/lib/stripe/client.ts:38`; `server/routes/billing-routes.ts:204,627,965` |
| Google Cloud — tutor AI | `apps/workers/tutor-orchestrator/src/lib/vertex-client.ts:220,311`; model endpoint `global` (`apps/workers/tutor-orchestrator/cloudbuild.yaml:10-15`) |
| Google Cloud — content safety | `server/services/tutor-model-armor.ts:80,300`; `server/services/tutor-crisis.ts:394-424` |
| Google Cloud — background processing | `server/services/cloud-tasks-enqueue.ts:97`; `infra/terraform/cloud-tasks.tf`, `cloud-scheduler*.tf`, `cloud-run.tf` |
| Google sign-in | `client/src/contexts/SupabaseAuthContext.tsx:463` |
| Resend | `server/lib/notifications/transport.ts:34,193` |
| Desmos | `client/src/components/math/DesmosCalculator.tsx:104` |
| Slack | `server/services/crisis-notification.ts:13,96-129` (payload: IDs, reason label, SLA, admin link) |
| **Not listed, not configured:** error-monitoring webhook | `ERROR_MONITOR_WEBHOOK_URL` not configured on Vercel, verified 2026-10-03 (Karl). The code path is `server/logger.ts:685-713` (it would send raw IP and a digested user ID) and is inert while the variable is unset; destination "unspecified" in `infra/secret-class-inventory.yaml:211`. Setting the variable adds a sub-processor and needs this list and Privacy Policy v5 §5.2 updated first |
| **Removed since v4:** Google BigQuery | Never installed; nothing archived (SCL-106; `server/services/retention-sweep.ts:349-355`) |
| **Not listed, removed:** Google Fonts | Self-hosted on `seo` by #1088 (`a6944733`, SEO-1); no `fonts.googleapis.com` reference remains in `client/index.html`. Must be live in production before publication |

---

## Standard sources followed

* GDPR Article 28(2) and (4) (sub-processor authorisation and flow-down) and Article 30 (records of processing) — https://eur-lex.europa.eu/eli/reg/2016/679/oj
* Doc 10 §9.18 field list (name, category, data categories, location, safeguards reference)
* Common EdTech and SaaS practice of publishing a sub-processor page, as referenced in Doc 10 §9.18

## Counsel checklist

1. **Locations and transfer mechanisms.** Fill in each **[TO CONFIRM]** location from the provider contracts and DPAs, and add the transfer safeguard for each (SCCs, UK IDTA or addendum, or the Data Privacy Framework).
2. **Error monitoring.** Resolved: not configured on Vercel, verified 2026-10-03 (Karl), so it is omitted. No action unless it is configured later.
3. **Desmos and Slack.** Confirm both are processors. Desmos is loaded by the user's browser; Slack is an internal staff tool that receives only internal reference numbers.
4. **Change-notice period.** Decide whether to commit to a notice period before adding a sub-processor (e.g. 30 days), as B2B and school DPAs often require.
5. **DPAs in place.** Confirm a signed DPA exists with each provider before publication. The PostHog DPA is a precondition of plan R32.
