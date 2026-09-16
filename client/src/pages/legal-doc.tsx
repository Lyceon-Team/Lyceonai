/**
 * @spec [LYCEON legal versioning Phase 2 §1, §3; Coding Standards §11.1, §11.2]
 * @implemented 2026-09-15
 *
 * plain English: renders one legal document from `legal/`. The manifest names
 * the current version, `meta.yml` supplies the version and effective date shown
 * in the header, and `en.md` is the body — split on its `##` headings so the
 * table of contents, search and scroll-spy keep working.
 *
 * expected outcome: what the page shows is what the repository says, and the
 * date beside the title comes from `meta.yml` rather than from anything typed
 * into the body. Changing `current` in a manifest changes what renders, with no
 * code change.
 *
 * trade-offs:
 *  - Body text is rendered by react-markdown with remark-gfm, because these
 *    documents contain tables. The previous hand-rolled renderer parsed a
 *    bespoke plain-text shape that no longer exists.
 *  - A failure to load is an error card, never placeholder or cached text.
 *    Showing the wrong contract silently is worse than showing none.
 *
 * edge cases:
 *  - `current: null` (billing-terms today) renders a "not yet published" state,
 *    not a 404 and not a 500.
 *  - A slug with no manifest in `legal/` 404s — a routing miss rather than a
 *    publication state, and distinct from a manifest that exists but will not
 *    parse, which is an error card.
 *
 * WHAT GATED THIS BEFORE. The page used to 404 any slug absent from
 * `client/src/lib/legal.ts`, a six-entry list built for the hub and for consent
 * keys. Three of the nine migrated documents are not in it — `refund-policy`,
 * `subscription-auto-renewal-notice` and `billing-terms` — so all three 404'd
 * in the browser while every loader-level test passed, because the tests called
 * the loader and the gate sat above it. Publication is a property of `legal/`,
 * so `legal/` decides; the registry now only feeds the hub and consent.
 */
import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  Search,
  Menu,
  X,
  Calendar,
  FileClock,
  AlertTriangle,
} from "lucide-react";
import { loadLegalDocument } from "@/lib/legal-content";
import Footer from "@/components/layout/Footer";
import NotFound from "./not-found";

function formatEffectiveDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function LegalDocPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>("");
  const [tocOpen, setTocOpen] = useState(false);

  const { data: content, isLoading } = useQuery({
    queryKey: ["legal-document", slug],
    queryFn: () => loadLegalDocument(slug || ""),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
  });

  const sections = useMemo(
    () => (content?.state === "published" ? content.sections : []),
    [content],
  );

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const query = searchQuery.toLowerCase();
    return sections.filter(
      (section) =>
        section.title.toLowerCase().includes(query) ||
        section.markdown.toLowerCase().includes(query),
    );
  }, [sections, searchQuery]);

  useEffect(() => {
    if (filteredSections.length > 0 && !activeSection) {
      setActiveSection(filteredSections[0].id);
    }
  }, [filteredSections, activeSection]);

  useEffect(() => {
    const handleScroll = () => {
      const nodes = document.querySelectorAll("[data-section-id]");
      let current = "";
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top <= 120) {
          current = node.getAttribute("data-section-id") || "";
        }
      });
      if (current) setActiveSection(current);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.querySelector(`[data-section-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTocOpen(false);
  };

  const shell = (children: React.ReactNode) => (
    <div className="legal-document min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/legal">
                <a className="inline-flex items-center gap-2">
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Back to Legal Hub</span>
                  <span className="sm:hidden">Back</span>
                </a>
              </Link>
            </Button>

            <div className="flex items-center gap-2">
              {content?.state === "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setTocOpen(!tocOpen)}
                  data-testid="button-toc-toggle"
                >
                  {tocOpen ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Menu className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );

  if (isLoading || !content) {
    return shell(
      <p className="text-muted-foreground" data-testid="text-legal-loading">
        Loading document…
      </p>,
    );
  }

  if (content.state === "unpublished") {
    return shell(
      <Card className="border-dashed" data-testid="card-legal-unpublished">
        <CardContent className="py-12 text-center">
          <FileClock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-lg font-medium text-foreground mb-2">
            {content.title}
          </h1>
          <p className="text-muted-foreground">
            This document has not been published yet. When it is, it will appear
            here with its version and effective date.
          </p>
        </CardContent>
      </Card>,
    );
  }

  if (content.state === "not-found") {
    // No manifest at this slug — a routing miss, not a broken document.
    return <NotFound />;
  }

  if (content.state === "error") {
    // No fallback text, deliberately. Stale or placeholder contract text is
    // worse than an error page.
    return shell(
      <Card className="border-destructive/40" data-testid="card-legal-error">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h1 className="text-lg font-medium text-foreground mb-2">
            This document could not be loaded
          </h1>
          <p className="text-muted-foreground">
            Please try again, or contact support@lyceon.ai if it keeps
            happening.
          </p>
        </CardContent>
      </Card>,
    );
  }

  return shell(
    <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-8">
      <aside
        className={`
          ${tocOpen ? "fixed inset-0 z-50 bg-background p-6 pt-20 overflow-auto" : "hidden"}
          lg:block lg:relative lg:z-auto lg:p-0 lg:bg-transparent
        `}
      >
        {tocOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-4 right-4 lg:hidden"
            onClick={() => setTocOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <div className="lg:sticky lg:top-24">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search in document..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-legal-search"
              />
            </div>
          </div>

          <h3 className="text-sm font-semibold text-foreground mb-3">
            Table of Contents
          </h3>
          <ScrollArea className="h-[calc(100vh-280px)]">
            <nav className="space-y-1">
              {sections
                .filter((section) => section.title.length > 0)
                .map((section) => {
                  const isFiltered =
                    searchQuery.trim() &&
                    !filteredSections.some((s) => s.id === section.id);

                  return (
                    <button
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      className={`
                        w-full text-left px-3 py-2 text-sm rounded-md transition-colors
                        ${
                          activeSection === section.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }
                        ${isFiltered ? "opacity-40" : ""}
                      `}
                    >
                      {section.title}
                    </button>
                  );
                })}
            </nav>
          </ScrollArea>
        </div>
      </aside>

      <article className="min-w-0">
        <div className="mb-8">
          <h1
            className="text-2xl sm:text-3xl font-bold text-foreground mb-3"
            data-testid="text-legal-title"
          >
            {content.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="secondary" data-testid="badge-legal-version">
              Version {content.version}
            </Badge>
            <span className="inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span data-testid="text-legal-effective-date">
                Effective {formatEffectiveDate(content.effectiveDate)}
              </span>
            </span>
          </div>
          {searchQuery.trim() && (
            <Badge variant="secondary" className="mt-3">
              {filteredSections.length} section
              {filteredSections.length !== 1 ? "s" : ""} matching "{searchQuery}
              "
            </Badge>
          )}
        </div>

        <div className="space-y-8">
          {(searchQuery.trim() ? filteredSections : sections).map((section) => (
            <Card
              key={section.id}
              data-section-id={section.id}
              className="scroll-mt-24"
            >
              <CardContent className="pt-6">
                {section.title.length > 0 && (
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    {section.title}
                  </h2>
                )}
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {section.markdown}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredSections.length === 0 && searchQuery.trim() && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No results found
              </h3>
              <p className="text-muted-foreground mb-4">
                No sections match your search for "{searchQuery}"
              </p>
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            </CardContent>
          </Card>
        )}
      </article>
    </div>,
  );
}
