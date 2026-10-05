import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0, §5 F6 (404 copy)] |
 * @implemented [2026-10-03] | plain English: the catch-all page. Generic copy and a link home;
 * it used to tell visitors to "add the page to the router", a developer message about how the
 * app is built. Rendered into the static 404.html as well (`client/src/prerender`).
 */
export default function NotFound(): JSX.Element {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-amber-600" />
            <h1 className="text-2xl font-bold text-gray-900">Page not found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Sorry, we couldn't find that page.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/" className="font-medium underline underline-offset-2">
              Go to the homepage
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
