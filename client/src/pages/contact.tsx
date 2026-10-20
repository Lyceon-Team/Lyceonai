/**
 * /contact — how to reach Lyceon. A static public page with no form.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §2: "a new small static public page with the support email, the postal
 *       address, 'Signed in? Use Send feedback in your account menu.' No form: no data collection
 *       from signed-out visitors, and no spam handling"; Public Disclosure Doctrine rule 1
 *       (industry standard)] | @implemented [2026-10-20]
 *
 * plain English: the footer's "Feedback" link lands here. It shows the support address as text
 * (a mailto link as a convenience), the postal address, and where signed-in students and parents
 * send feedback from. Nothing is collected on this page and it calls no API, so it prerenders.
 */
import PublicLayout from "@/components/layout/PublicLayout";
import {
  LYCEON_POSTAL_ADDRESS,
  SUPPORT_EMAIL,
} from "../../../packages/shared/src/support-contact";

export default function ContactPage(): JSX.Element {
  return (
    <PublicLayout>
      <div
        className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16"
        data-testid="contact-page"
      >
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
            Contact Lyceon
          </h1>
          <p className="text-lg text-muted-foreground">
            Questions, problems or ideas? Here's how to reach us.
          </p>
        </header>

        <section
          className="flex flex-col gap-2"
          aria-labelledby="contact-email-h"
        >
          <h2 id="contact-email-h" className="text-xl font-semibold">
            Email
          </h2>
          <p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold underline underline-offset-4"
              data-testid="contact-email"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>

        <section
          className="flex flex-col gap-2"
          aria-labelledby="contact-feedback-h"
        >
          <h2 id="contact-feedback-h" className="text-xl font-semibold">
            Feedback
          </h2>
          <p data-testid="contact-signed-in">
            Signed in? Use <strong>Send feedback</strong> in your account menu.
          </p>
        </section>

        <section
          className="flex flex-col gap-2"
          aria-labelledby="contact-post-h"
        >
          <h2 id="contact-post-h" className="text-xl font-semibold">
            Mail
          </h2>
          <address className="not-italic" data-testid="contact-address">
            {LYCEON_POSTAL_ADDRESS}
          </address>
        </section>
      </div>
    </PublicLayout>
  );
}
