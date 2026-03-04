import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  Download,
  ExternalLink,
  Search,
  Menu,
  X,
  Calendar
} from "lucide-react";
import { getLegalDocBySlug } from "@/lib/legal";
import Footer from "@/components/layout/Footer";
import NotFound from "./not-found";

export default function LegalDocPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = getLegalDocBySlug(slug || '');
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>("");
  const [tocOpen, setTocOpen] = useState(false);

  const filteredSections = useMemo(() => {
    if (!doc) return [];
    if (!searchQuery.trim()) return doc.sections;

    const query = searchQuery.toLowerCase();
    return doc.sections.filter(section =>
      section.title.toLowerCase().includes(query) ||
      section.content.toLowerCase().includes(query)
    );
  }, [doc, searchQuery]);

  useEffect(() => {
    if (filteredSections.length > 0 && !activeSection) {
      setActiveSection(filteredSections[0].id);
    }
  }, [filteredSections, activeSection]);

  useEffect(() => {
    const handleScroll = () => {
      const sections = document.querySelectorAll('[data-section-id]');
      let current = '';

      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 150) {
          current = section.getAttribute('data-section-id') || '';
        }
      });

      if (current) {
        setActiveSection(current);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.querySelector(`[data-section-id="${sectionId}"]`);
    if (element) {
      const offset = 100;
      const top = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
      setActiveSection(sectionId);
      setTocOpen(false);
    }
  };

  const highlightText = (text: string) => {
    if (!searchQuery.trim()) return text;

    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">{part}</mark>
        : part
    );
  };

  const renderContent = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let currentList: string[] = [];
    let listKey = 0;

    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(
          <ul key={`list-${listKey++}`} className="list-disc list-inside space-y-1 my-3 text-muted-foreground">
            {currentList.map((item, i) => (
              <li key={i}>{highlightText(item)}</li>
            ))}
          </ul>
        );
        currentList = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('- ')) {
        currentList.push(trimmed.substring(2));
      } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        flushList();
        elements.push(
          <h4 key={index} className="font-semibold text-foreground mt-4 mb-2">
            {highlightText(trimmed.slice(2, -2))}
          </h4>
        );
      } else if (trimmed) {
        flushList();
        const formatted = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        elements.push(
          <p
            key={index}
            className="text-muted-foreground mb-3"
            dangerouslySetInnerHTML={{
              __html: searchQuery.trim()
                ? formatted.replace(
                  new RegExp(`(${searchQuery})`, 'gi'),
                  '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">$1</mark>'
                )
                : formatted
            }}
          />
        );
      } else {
        flushList();
      }
    });

    flushList();
    return elements;
  };

  if (!doc) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>{doc.title} | Lyceon</title>
        <meta name="description" content={doc.shortDescription} />
        <link rel="canonical" href={`https://lyceon.ai/legal/${doc.slug}`} />
        <meta property="og:title" content={`${doc.title} | Lyceon`} />
        <meta property="og:description" content={doc.shortDescription} />
        <meta property="og:url" content={`https://lyceon.ai/legal/${doc.slug}`} />
        <meta property="og:type" content="article" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`${doc.title} | Lyceon`} />
        <meta name="twitter:description" content={doc.shortDescription} />
      </Helmet>

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
              <a href={doc.pdfPath} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">View PDF</span>
                </Button>
              </a>
              <a href={doc.pdfPath} download>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
              </a>
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setTocOpen(!tocOpen)}
              >
                {tocOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-8">
            <aside className={`
              ${tocOpen ? 'fixed inset-0 z-50 bg-background p-6 pt-20 overflow-auto' : 'hidden'}
              lg:block lg:relative lg:z-auto lg:p-0 lg:bg-transparent
            `}>
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
                    />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-foreground mb-3">Table of Contents</h3>
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <nav className="space-y-1">
                    {doc.sections.map((section) => {
                      const isFiltered = searchQuery.trim() && !filteredSections.some(s => s.id === section.id);

                      return (
                        <button
                          key={section.id}
                          onClick={() => scrollToSection(section.id)}
                          className={`
                            w-full text-left px-3 py-2 text-sm rounded-md transition-colors
                            ${activeSection === section.id
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            }
                            ${isFiltered ? 'opacity-40' : ''}
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
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
                  {doc.title}
                </h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Last Updated: {doc.lastUpdated}</span>
                </div>
                {searchQuery.trim() && (
                  <Badge variant="secondary" className="mt-3">
                    {filteredSections.length} section{filteredSections.length !== 1 ? 's' : ''} matching "{searchQuery}"
                  </Badge>
                )}
              </div>

              <div className="space-y-8">
                {(searchQuery.trim() ? filteredSections : doc.sections).map((section) => (
                  <Card
                    key={section.id}
                    data-section-id={section.id}
                    className="scroll-mt-24"
                  >
                    <CardContent className="pt-6">
                      <h2 className="text-lg font-semibold text-foreground mb-4">
                        {highlightText(section.title)}
                      </h2>
                      <div className="prose prose-sm max-w-none">
                        {renderContent(section.content)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {filteredSections.length === 0 && searchQuery.trim() && (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center">
                    <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No results found</h3>
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
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
