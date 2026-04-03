import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, CheckCircle2, Lock, Mail, Shield, Users } from "lucide-react";
import Footer from "@/components/layout/Footer";

export default function TutorPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Lyceon Tutor | Safety, Privacy, and Pedagogy</title>
        <meta
          name="description"
          content="How Lyceon's SAT-aligned tutor handles safety, privacy, and learning guidance. Clear boundaries, transparent data use, and adaptive pedagogy."
        />
        <link rel="canonical" href="https://lyceon.ai/tutor" />
        <meta property="og:title" content="Lyceon Tutor | Safety, Privacy, and Pedagogy" />
        <meta
          property="og:description"
          content="How Lyceon's SAT-aligned tutor handles safety, privacy, and learning guidance. Clear boundaries, transparent data use, and adaptive pedagogy."
        />
        <meta property="og:url" content="https://lyceon.ai/tutor" />
        <meta property="og:type" content="website" />
      </Helmet>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
              Tutor Safety, Privacy, and Pedagogy
            </h1>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              Lyceon’s tutor is SAT-aligned (not SAT-official) and built to guide learning with clear
              boundaries, transparent data use, and adaptive instruction.
            </p>
          </div>

          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Boundaries &amp; Safety
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    SAT-aligned, not official
                  </CardTitle>
                  <CardDescription>
                    The tutor is grounded in SAT-style practice and explanations. It does not claim to be
                    an official College Board product.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    No answer leakage
                  </CardTitle>
                  <CardDescription>
                    Pre-submit question payloads do not expose correct answers or explanations. The tutor
                    focuses on reasoning, not shortcuts.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Academic integrity
                  </CardTitle>
                  <CardDescription>
                    The tutor is not intended for live or proctored exams and should not be used to
                    bypass school rules or assignments.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Privacy &amp; Data Use
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Student-first control
                  </CardTitle>
                  <CardDescription>
                    Students own learning actions and plans. Guardians can view progress but do not take
                    actions on a student’s behalf.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    No data selling or ads
                  </CardTitle>
                  <CardDescription>
                    Student data is not sold and is not used to build advertising profiles or targeted ad
                    audiences.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Deletion &amp; de-identification
                  </CardTitle>
                  <CardDescription>
                    Families can request deletion of student data. De-identified or aggregated analytics
                    may be retained to improve learning outcomes.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Pedagogy &amp; Adaptation
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    Skill-level focus
                  </CardTitle>
                  <CardDescription>
                    Practice and diagnostics highlight the specific skills that need focus, with domain
                    and section rollups for clarity.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Step-by-step guidance
                  </CardTitle>
                  <CardDescription>
                    Explanations are structured to show reasoning and help students learn the method,
                    not just the final answer.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Review loops
                  </CardTitle>
                  <CardDescription>
                    Mistakes feed review sessions so students can re-practice weak areas with fresh
                    explanations and targeted drills.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4">Explore Trust &amp; Policy Details</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild variant="outline">
                <Link href="/trust">Open Trust Center</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/legal/privacy-policy">Read Privacy Policy</Link>
              </Button>
            </div>
          </section>

          <Card className="bg-muted/30">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Questions or concerns?</h3>
                  <p className="text-sm text-muted-foreground">
                    Report safety issues or ask about privacy at support@lyceon.ai.
                  </p>
                </div>
                <Button asChild>
                  <a href="mailto:support@lyceon.ai" className="inline-flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    support@lyceon.ai
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
