import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import Footer from "@/components/layout/Footer";

/**
 * Trust & Safety Hub — public SEO/AEO landing page at /trust.
 * Links into /legal (Legal Hub) and individual policy slugs.
 * No legal text is authored here; all content lives in
 * client/src/lib/legal.ts and the corresponding PDFs.
 */
export default function TrustHub() {
    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Helmet>
                <title>Trust &amp; Safety Hub | Lyceon</title>
                <meta
                    name="description"
                    content="Lyceon's Trust &amp; Safety Hub: privacy protections, data security practices, and academic integrity policies."
                />
                <link rel="canonical" href="https://lyceon.ai/trust" />
                <meta property="og:title" content="Trust &amp; Safety Hub | Lyceon" />
                <meta
                    property="og:description"
                    content="Lyceon's Trust &amp; Safety Hub: privacy protections, data security practices, and academic integrity policies."
                />
                <meta property="og:url" content="https://lyceon.ai/trust" />
                <meta property="og:type" content="website" />
                <meta name="twitter:card" content="summary" />
                <meta name="twitter:title" content="Trust &amp; Safety Hub | Lyceon" />
                <meta
                    name="twitter:description"
                    content="Lyceon's Trust &amp; Safety Hub: privacy protections, data security practices, and academic integrity policies."
                />
            </Helmet>

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
                            Privacy, security, and academic integrity are built into every part
                            of Lyceon. Explore our policies and commitments below.
                        </p>
                    </div>

                    {/* Policies & Terms */}
                    <section className="mb-12">
                        <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
                            <Scale className="h-5 w-5 text-primary" />
                            Policies &amp; Terms
                        </h2>

                        <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-4">
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
                                        <Link href="/legal">
                                            <a className="inline-flex items-center gap-1">
                                                View All Policies
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
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
                                    <CardTitle className="text-base">Trust &amp; Safety</CardTitle>
                                    <CardDescription className="text-sm">
                                        How we approach trust, safety, and responsibility in AI-powered learning.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-0 mt-auto">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href="/legal/trust-and-safety">
                                            <a className="inline-flex items-center gap-1">
                                                Read Policy
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
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
                                        <Link href="/legal/privacy-policy">
                                            <a className="inline-flex items-center gap-1">
                                                Read Policy
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
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
                                    <CardTitle className="text-base">Student Terms of Use</CardTitle>
                                    <CardDescription className="text-sm">
                                        The terms that govern your access to and use of Lyceon.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-0 mt-auto">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href="/legal/student-terms">
                                            <a className="inline-flex items-center gap-1">
                                                Read Terms
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
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
                                        <Link href="/legal/honor-code">
                                            <a className="inline-flex items-center gap-1">
                                                Read Honor Code
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
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
                                    <CardTitle className="text-base">Community Guidelines</CardTitle>
                                    <CardDescription className="text-sm">
                                        How users are expected to behave when using Lyceon.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-0 mt-auto">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href="/legal/community-guidelines">
                                            <a className="inline-flex items-center gap-1">
                                                Read Guidelines
                                                <ChevronRight className="h-4 w-4" />
                                            </a>
                                        </Link>
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </section>

                    {/* Contact */}
                    <Card className="bg-muted/30">
                        <CardContent className="py-6">
                            <div className="flex flex-col sm:flex-row items-center gap-4">
                                <div className="p-3 rounded-full bg-primary/10">
                                    <Mail className="h-6 w-6 text-primary" />
                                </div>
                                <div className="text-center sm:text-left flex-1">
                                    <h3 className="font-semibold text-foreground mb-1">Contact Trust &amp; Safety</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Questions about trust or safety? We're here to help.
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
