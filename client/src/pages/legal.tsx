import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Users,
  Lock,
  Award,
  FileText,
  UserCheck,
  Mail,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  legalIndexQueryOptions,
  type LegalIndexEntry,
} from "@/lib/legal-content";
import Footer from "@/components/layout/Footer";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

/** Part G (2026-10-21): the hub's cards and badges in the student tokens. */
const CARD = "rounded-lg border border-lyc-rule bg-lyc-sheet text-lyc-ink";
const BADGE =
  "inline-flex items-center rounded-full border border-lyc-rule bg-lyc-chip px-3 py-0.5 text-lyc-meta font-semibold text-lyc-ink-strong";

const docIcons: Record<string, React.ReactNode> = {
  "trust-and-safety": <Shield className="h-6 w-6" />,
  "community-guidelines": <Users className="h-6 w-6" />,
  "privacy-policy": <Lock className="h-6 w-6" />,
  "honor-code": <Award className="h-6 w-6" />,
  "student-terms": <FileText className="h-6 w-6" />,
  "parent-guardian-terms": <UserCheck className="h-6 w-6" />,
};

export default function LegalHub() {
  // THE HUB ENUMERATES `legal/`. It used to map over a six-entry array in
  // client/src/lib/legal.ts, which is why three published documents —
  // billing-terms, refund-policy and subscription-auto-renewal-notice — never
  // appeared here despite rendering at their own URLs. A reader browsing saw
  // two thirds of the corpus.
  //
  // `index.json` is generated from the directory at build time and answers
  // only "which documents exist"; title, description and order come from each
  // manifest. Publishing a tenth document puts it on this page with no code
  // change, which is the point of the structure.
  const { data: index } = useQuery(legalIndexQueryOptions());

  // Only published documents are listed. A slug at `current: null` exists and
  // resolves citations, but there is nothing yet for a reader to open.
  const published = (index ?? [])
    .filter(
      (e): e is Extract<LegalIndexEntry, { state: "published" }> =>
        e.state === "published",
    )
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const trustDoc = published.find((d) => d.slug === "trust-and-safety");

  // 2026-10-21 (owner brief "student cleanups", Karl, Part G: "Render in dark mode with the
  // student tokens; no text below 14px"): a `.lyc` root in the student tokens, so the hub follows
  // the device / saved theme like the student pages; the smallest text is 14px (`text-lyc-meta`),
  // where badges and descriptions were 12px. Content, order and links are unchanged.
  return (
    <div
      className="lyc min-h-screen bg-lyc-paper text-lyc-ink flex flex-col"
      data-testid="legal-hub"
    >
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-lyc-chip mb-4">
              <Shield className="h-8 w-8 text-lyc-ink-strong" />
            </div>
            <h1 className="font-lyc-serif text-lyc-section sm:text-lyc-title font-semibold text-lyc-ink-strong mb-4">
              Legal & Trust
            </h1>
            <p className="text-lyc-body-lg text-lyc-muted max-w-2xl mx-auto">
              Our policies and terms.
            </p>
          </div>

          {trustDoc && (
            <section className={`${CARD} mb-10 p-6`}>
              <div className="flex items-start gap-4 mb-4">
                <div className="p-3 rounded-lg bg-lyc-chip">
                  <Shield className="h-6 w-6 text-lyc-ink-strong" />
                </div>
                <h2 className="flex-1 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong">
                  {/* From the manifest. Hardcoded here it read "Trust &
                      Safety at Lyceon" — old branding, against the
                      corpus's LYCEON, and drifted precisely because it
                      was a second copy of a document's name. */}
                  {trustDoc.title}
                </h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="flex items-start gap-3">
                  <span className={`${BADGE} mt-1 shrink-0`}>1</span>
                  <div>
                    <p className="font-semibold text-lyc-meta-lg text-lyc-ink-strong">
                      Academic integrity
                    </p>
                    <p className="text-lyc-meta text-lyc-muted">
                      See our Honor Code.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className={`${BADGE} mt-1 shrink-0`}>2</span>
                  <div>
                    <p className="font-semibold text-lyc-meta-lg text-lyc-ink-strong">
                      Privacy & Data Security
                    </p>
                    <p className="text-lyc-meta text-lyc-muted">
                      No data selling, no targeted advertising
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="lyc-outline" size="lyc">
                  <Link
                    href="/legal/trust-and-safety"
                    className="inline-flex items-center gap-1"
                  >
                    Read Full Policy
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </section>
          )}

          <div className="mb-8">
            <h2 className="font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong mb-4">
              Our Policies
            </h2>
            <p className="text-lyc-muted mb-6">
              Review our complete legal documentation below.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            {published
              .filter((d) => d.slug !== "trust-and-safety")
              .map((doc) => (
                <section key={doc.slug} className={`${CARD} flex flex-col p-6`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-lyc-chip text-lyc-ink-strong">
                      {docIcons[doc.slug] || <FileText className="h-5 w-5" />}
                    </div>
                    <span
                      className={BADGE}
                      data-testid={`badge-version-${doc.slug}`}
                    >
                      Version {doc.version}
                    </span>
                  </div>
                  <h3 className="font-semibold text-lyc-body text-lyc-ink-strong mb-1">
                    {doc.title}
                  </h3>
                  <p className="text-lyc-meta text-lyc-muted mb-4">
                    {doc.description}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button
                      asChild
                      variant="lyc-outline"
                      size="lyc"
                      className="flex-1"
                    >
                      <Link
                        href={`/legal/${doc.slug}`}
                        className="inline-flex items-center gap-1"
                      >
                        Read
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </section>
              ))}
          </div>

          <section className={`${CARD} p-6`}>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="p-3 rounded-full bg-lyc-chip">
                <Mail className="h-6 w-6 text-lyc-ink-strong" />
              </div>
              <div className="text-center sm:text-left flex-1">
                <h3 className="font-semibold text-lyc-ink-strong mb-1">
                  Contact Trust & Safety
                </h3>
                <p className="text-lyc-meta text-lyc-muted">
                  Questions about trust or safety? We're here to help.
                </p>
              </div>
              <Button asChild variant="lyc-primary" size="lyc">
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="inline-flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  {SUPPORT_EMAIL}
                </a>
              </Button>
            </div>
          </section>
        </div>
      </main>

      <Footer tone="navy" />
    </div>
  );
}
