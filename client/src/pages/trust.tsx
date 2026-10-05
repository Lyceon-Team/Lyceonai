import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Lock,
  FileText,
  Award,
  Users,
  ChevronRight,
  Mail,
  Scale,
  UserCheck,
} from "lucide-react";
import Footer from "@/components/layout/Footer";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

/**
 * Trust & Safety Hub — public SEO/AEO landing page at /trust.
 * Links into /legal (Legal Hub) and individual policy slugs.
 * No legal text is authored here; all content lives in
 * client/src/lib/legal.ts and the corresponding PDFs.
 */
export default function TrustHub() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Trust &amp; Safety
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our approach to privacy, security and academic integrity. Read our
              policies below.
            </p>
          </div>

          {/* Commitments */}
          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              What We Commit To
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Student-first model
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Parents and guardians who link to a student's account get a
                    read-only view.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Account deletion</CardTitle>
                  <CardDescription className="text-sm">
                    You can ask us to delete your account. See the{" "}
                    <Link href="/legal/privacy-policy" className="underline">
                      Privacy Policy
                    </Link>{" "}
                    for what we keep and why.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    No data selling or ads
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Student data is not sold and not used for targeted
                    advertising.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Not affiliated with the College Board
                  </CardTitle>
                  <CardDescription className="text-sm">
                    SAT® is a trademark registered by the College Board, which
                    is not affiliated with, and does not endorse, this product.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          {/* Policies & Terms */}
          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              Policies &amp; Terms
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-4">
              {/* F14 / F6 (2026-10-03): the "Trust Evidence" card (its page is removed) and the
                  "Tutor Transparency" card (it linked to the signed-in tutor) are gone; nothing
                  from either is folded in here (owner answer 7). */}
              {/* Legal Hub */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <FileText className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">Legal Hub</CardTitle>
                  <CardDescription className="text-sm">
                    All Lyceon policies and legal documents in one place.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal"
                      className="inline-flex items-center gap-1"
                    >
                      View All Policies
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Trust & Safety */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <Shield className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">
                    Trust &amp; Safety
                  </CardTitle>
                  <CardDescription className="text-sm">
                    How we approach trust, safety, and responsible technology in
                    learning.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal/trust-and-safety"
                      className="inline-flex items-center gap-1"
                    >
                      Read Policy
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Privacy Policy */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <Lock className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">Privacy Policy</CardTitle>
                  <CardDescription className="text-sm">
                    How we collect, use, store, share, and protect information.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal/privacy-policy"
                      className="inline-flex items-center gap-1"
                    >
                      Read Policy
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Student Terms */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <FileText className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">
                    Student Terms of Use
                  </CardTitle>
                  <CardDescription className="text-sm">
                    The terms that govern your access to and use of Lyceon.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal/student-terms"
                      className="inline-flex items-center gap-1"
                    >
                      Read Terms
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Academic Integrity */}
          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              Academic Integrity
            </h2>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Honor Code */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <Award className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">Honor Code</CardTitle>
                  <CardDescription className="text-sm">
                    Our commitment to honest learning and academic integrity.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal/honor-code"
                      className="inline-flex items-center gap-1"
                    >
                      Read Honor Code
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Community Guidelines */}
              <Card className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <Users className="h-5 w-5" />
                    </div>
                  </div>
                  <CardTitle className="text-base">
                    Community Guidelines
                  </CardTitle>
                  <CardDescription className="text-sm">
                    How users are expected to behave when using Lyceon.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 mt-auto">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href="/legal/community-guidelines"
                      className="inline-flex items-center gap-1"
                    >
                      Read Guidelines
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Responsible Disclosure
            </h2>
            <Card className="bg-muted/30">
              <CardContent className="py-6">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-center sm:text-left flex-1">
                    <h3 className="font-semibold text-foreground mb-1">
                      Security contact
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      If you believe you've found a security issue, contact{" "}
                      {SUPPORT_EMAIL} with details.
                    </p>
                  </div>
                  <Button asChild>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="inline-flex items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      {SUPPORT_EMAIL}
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Contact */}
          <Card className="bg-muted/30">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    Contact Trust &amp; Safety
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Questions about trust, safety, or security? We're here to
                    help.
                  </p>
                </div>
                <Button asChild>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="inline-flex items-center gap-2"
                  >
                    <Mail className="h-4 w-4" />
                    {SUPPORT_EMAIL}
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
