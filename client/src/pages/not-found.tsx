import { Link } from "wouter";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { buttonVariants } from "@/components/ui/button";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { guardianPaths } from "@/features/guardian/paths";

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0, §5 F6 (404 copy)] |
 * @implemented [2026-10-03] | plain English: the catch-all page. Generic copy and a link home;
 * it used to tell visitors to "add the page to the router", a developer message about how the
 * app is built. Rendered into the static 404.html as well (`client/src/prerender`).
 *
 * @spec [production re-test 2026-10-08 item E (Karl: "restyle the 404 page with student tokens,
 *        fonts and theme"); DESIGN.md §1, §2 "Bare card" (the 404 is a Bare-card page)]
 *        | @implemented [2026-10-08]
 * plain English: the card's content only; App.tsx's catch-all frames it in the Bare card
 * (`BareCard`), so it is drawn with the student tokens and fonts in the visitor's theme, light or
 * dark, like sign-in and account recovery. The SEO copy is unchanged. The one way out is a filled
 * primary action that fits who is looking: a signed-in student (or admin) goes back to Home, a
 * guardian to the guardian home, and a signed-out visitor (and the static 404.html, which always
 * renders signed out) to the homepage, which carries sign-in. A display choice only: every page
 * behind these links is guarded by the server.
 */
export default function NotFound(): JSX.Element {
  const { user } = useSupabaseAuth();
  const way =
    user === null
      ? { href: "/", label: "Go to the homepage" }
      : user.role === "guardian"
        ? { href: guardianPaths.home, label: "Back to Home" }
        : { href: "/dashboard", label: "Back to Home" };
  return (
    <div className="flex flex-col items-center" data-testid="not-found">
      <BareCardHeader
        title="Page not found"
        description="Sorry, we couldn't find that page."
        align="center"
      />
      <Link
        href={way.href}
        className={buttonVariants({
          variant: "lyc-primary",
          className: "no-underline",
        })}
        data-testid="not-found-way-out"
      >
        {way.label}
      </Link>
    </div>
  );
}
