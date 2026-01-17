import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, 
  Users, 
  Lock, 
  Award, 
  FileText, 
  UserCheck, 
  ExternalLink,
  Mail,
  ChevronRight
} from "lucide-react";
import { legalDocs } from "@/lib/legal";
import Footer from "@/components/layout/Footer";

const docIcons: Record<string, React.ReactNode> = {
  'trust-and-safety': <Shield className="h-6 w-6" />,
  'community-guidelines': <Users className="h-6 w-6" />,
  'privacy-policy': <Lock className="h-6 w-6" />,
  'honor-code': <Award className="h-6 w-6" />,
  'student-terms': <FileText className="h-6 w-6" />,
  'parent-guardian-terms': <UserCheck className="h-6 w-6" />,
};

export default function LegalHub() {
  const trustDoc = legalDocs.find(d => d.slug === 'trust-and-safety');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Legal & Trust | Lyceon</title>
        <meta name="description" content="Lyceon's legal policies, terms of use, privacy policy, and trust & safety information." />
        <link rel="canonical" href="https://lyceon.ai/legal" />
        <meta property="og:title" content="Legal & Trust | Lyceon" />
        <meta property="og:description" content="Lyceon's legal policies, terms of use, privacy policy, and trust & safety information." />
        <meta property="og:url" content="https://lyceon.ai/legal" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Legal & Trust | Lyceon" />
        <meta name="twitter:description" content="Lyceon's legal policies, terms of use, privacy policy, and trust & safety information." />
      </Helmet>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Legal & Trust
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Empowering students to learn with integrity in an AI-driven world.
            </p>
          </div>

          {trustDoc && (
            <Card className="mb-10 border-primary/20 bg-primary/5">
              <CardHeader>
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-primary/10">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl mb-2">Trust & Safety at Lyceon</CardTitle>
                    <CardDescription className="text-base">
                      At Lyceon, we believe technology should strengthen learning, not replace it. 
                      We've built the platform with a safety-first, integrity-driven foundation.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-1 shrink-0">1</Badge>
                    <div>
                      <p className="font-medium text-sm">Academic Integrity First</p>
                      <p className="text-xs text-muted-foreground">We help students understand, not bypass learning</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-1 shrink-0">2</Badge>
                    <div>
                      <p className="font-medium text-sm">Privacy & Data Security</p>
                      <p className="text-xs text-muted-foreground">No data selling, no targeted advertising</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-1 shrink-0">3</Badge>
                    <div>
                      <p className="font-medium text-sm">Responsible AI</p>
                      <p className="text-xs text-muted-foreground">Transparent, supervised, and safety-aware</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href="/legal/trust-and-safety">
                    <Button variant="outline" size="sm">
                      Read Full Policy
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                  <a 
                    href={trustDoc.pdfPath} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View PDF
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">Our Policies</h2>
            <p className="text-muted-foreground mb-6">
              Review our complete legal documentation below.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            {legalDocs.filter(d => d.slug !== 'trust-and-safety').map((doc) => (
              <Card key={doc.slug} className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      {docIcons[doc.slug] || <FileText className="h-5 w-5" />}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      Updated {doc.lastUpdated}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{doc.title}</CardTitle>
                  <CardDescription className="text-sm">
                    {doc.shortDescription}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/legal/${doc.slug}`}>
                      <Button variant="outline" size="sm" className="flex-1">
                        Read
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                    <a 
                      href={doc.pdfPath} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-muted/30">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Contact Trust & Safety</h3>
                  <p className="text-sm text-muted-foreground">
                    Questions about trust or safety? We're here to help.
                  </p>
                </div>
                <a href="mailto:support@lyceon.ai">
                  <Button>
                    <Mail className="h-4 w-4 mr-2" />
                    support@lyceon.ai
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
