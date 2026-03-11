import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FileCheck2, Lock, Shield, AlertTriangle } from "lucide-react";
import Footer from "@/components/layout/Footer";

export default function TrustEvidencePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Trust Evidence | Lyceon</title>
        <meta
          name="description"
          content="Public technical evidence for Lyceon security and privacy controls, including auth enforcement, RLS usage, and logging safeguards."
        />
        <link rel="canonical" href="https://lyceon.ai/trust/evidence" />
        <meta property="og:title" content="Trust Evidence | Lyceon" />
        <meta
          property="og:description"
          content="Public technical evidence for Lyceon security and privacy controls, including auth enforcement, RLS usage, and logging safeguards."
        />
        <meta property="og:url" content="https://lyceon.ai/trust/evidence" />
        <meta property="og:type" content="website" />
      </Helmet>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <FileCheck2 className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">Trust Evidence</h1>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              Public, implementation-grounded evidence for how Lyceon protects student data and enforces server-side authorization.
            </p>
          </div>

          <Card className="mb-8 border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/10">
            <CardContent className="py-4 text-sm text-amber-900 dark:text-amber-200 flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                This page does not make third-party certification claims (for example SOC 2 or ISO 27001) unless those claims are
                explicitly published by Lyceon.
              </p>
            </CardContent>
          </Card>

          <div className="grid sm:grid-cols-2 gap-4 mb-10">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> Cookie-Only Auth</CardTitle>
                <CardDescription>
                  For routes using Supabase auth middleware, auth is resolved from secure cookies and bearer headers are ignored.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <Badge variant="outline">Server-enforced</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Route Authorization</CardTitle>
                <CardDescription>
                  Admin, guardian, and student access is enforced by server middleware and route-level guards.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <Badge variant="outline">Source of truth: server</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Data Isolation</CardTitle>
                <CardDescription>
                  Supabase migrations enable RLS on core student-data tables with policies tied to auth identity (auth.uid()).
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <Badge variant="outline">Policy-backed</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Privacy-Safe Observability</CardTitle>
                <CardDescription>
                  Server request/error logging and monitor forwarding redact cookies, tokens, authorization data, and sensitive payload fields.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <Badge variant="outline">Redaction enabled</Badge>
              </CardContent>
            </Card>
          </div>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4">Related Public Pages</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Trust &amp; Safety Hub</CardTitle>
                  <CardDescription>Overview of policy commitments and safety posture.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/trust">
                      <a className="inline-flex items-center gap-1">Open /trust <ChevronRight className="h-4 w-4" /></a>
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Legal &amp; Policy Hub</CardTitle>
                  <CardDescription>Privacy policy, terms, trust &amp; safety, and community guidelines.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/legal">
                      <a className="inline-flex items-center gap-1">Open /legal <ChevronRight className="h-4 w-4" /></a>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
