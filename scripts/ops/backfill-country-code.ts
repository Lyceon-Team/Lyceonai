/**
 * W3-3 backfill — prints the SQL that records each already-entitled student's
 * billing country. WRITES NOTHING. The owner runs it, reads the output, and
 * applies the SQL.
 *
 * @spec [Doc-03_V3 §4.6, §12.3; INV-03-08; closure plan W3-3 §3.3]
 * @implemented 2026-09-25
 *
 * Usage:
 *   1. Export the students to fill (docs/plans/W3-3_country_backfill.sql, Q1) as
 *      JSON: [{ "profile_id": "...", "stripe_subscription_id": "sub_..." }, ...]
 *   2. STRIPE_SECRET_KEY=sk_live_... pnpm tsx scripts/ops/backfill-country-code.ts \
 *        --input students.json [--tier1 US,CA,GB,AU,NZ,IE,SG] > backfill.sql
 *   3. Review backfill.sql, apply it, then run Q2 for the counts.
 *
 * Read-only against Stripe: subscriptions.retrieve, customers.retrieve,
 * checkout.sessions.list. SQL goes to stdout; the summary (counts, and the
 * unresolved students as 8-character digests — no raw ids, no addresses) to
 * stderr.
 */
import { readFileSync } from "fs";
import { parseArgs } from "util";
import { z } from "zod";
import { getStripeClient } from "../../server/lib/stripe/client";
import {
  blankToNull,
  planCountryBackfill,
  type CountryBackfillInput,
} from "../../server/lib/stripe/country-backfill";
import { digestId } from "../../server/lib/stripe/redact";

const exportSchema = z.array(
  z.object({
    profile_id: z.string().uuid(),
    stripe_subscription_id: z.string().min(1),
  }),
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      tier1: { type: "string", default: "US,CA,GB,AU,NZ,IE,SG" },
    },
  });
  if (!values.input) throw new Error("--input <students.json> is required");
  const rows = exportSchema.parse(
    JSON.parse(readFileSync(values.input, "utf8")),
  );
  const tier1 = (values.tier1 ?? "").split(",").map((c) => c.trim());

  const stripe = getStripeClient();
  const inputs: CountryBackfillInput[] = [];
  for (const row of rows) {
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const customer = await stripe.customers.retrieve(customerId);
    // Blank (empty or whitespace) is no country — fall through to the session.
    const customerCountry = customer.deleted
      ? null
      : blankToNull(customer.address?.country);
    let sessionCountry: string | null = null;
    if (!customerCountry) {
      const sessions = await stripe.checkout.sessions.list({
        subscription: row.stripe_subscription_id,
        limit: 1,
      });
      sessionCountry =
        sessions.data[0]?.customer_details?.address?.country ?? null;
    }
    inputs.push({ profileId: row.profile_id, customerCountry, sessionCountry });
  }

  const plan = planCountryBackfill(inputs, tier1);
  process.stdout.write(
    [
      "-- W3-3 country backfill. Generated; review before applying.",
      "BEGIN;",
      ...plan.sql,
      "COMMIT;",
      "",
    ].join("\n"),
  );
  const bySource = (s: string): number =>
    plan.updates.filter((u) => u.source === s).length;
  process.stderr.write(
    [
      `students examined: ${inputs.length}`,
      `country found:     ${plan.updates.length} (customer: ${bySource("customer")}, checkout session: ${bySource("checkout_session")})`,
      `still null:        ${plan.unresolved.length}`,
      ...plan.unresolved.map(
        (u) =>
          `  ${digestId(u.profileId)}  ${u.reason}${u.country ? ` (${u.country})` : ""}`,
      ),
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `backfill failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
