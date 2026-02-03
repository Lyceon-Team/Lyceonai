import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Tag } from "@/components/common/tag";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, FileText, Users, Info, TrendingUp } from "lucide-react";
import { Link } from "wouter";

export default function FullTest() {
  return (
    <AppShell>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Full Length SAT Test
          </h1>
          <p className="text-muted-foreground">
            Take a complete practice test under realistic timed conditions
          </p>
        </div>

        {/* Test Information */}
        <PageCard
          title="Test Overview"
          description="Complete SAT Practice Test"
          className="mb-8"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-blue-100 ">
                <Clock className="h-6 w-6 text-blue-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Duration</h3>
              <p className="text-sm text-muted-foreground">3 hours 15 minutes</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-green-100 ">
                <FileText className="h-6 w-6 text-green-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Sections</h3>
              <p className="text-sm text-muted-foreground">Reading, Writing, Math</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-purple-100 ">
                <Users className="h-6 w-6 text-purple-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Format</h3>
              <p className="text-sm text-muted-foreground">Adaptive, Digital</p>
            </div>
          </div>

          {/* Before You Begin Info */}
          <div className="p-4 rounded-lg bg-amber-50 ">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-600 " />
              <div>
                <h4 className="font-semibold text-amber-800 ">Before You Begin</h4>
                <ul className="text-sm text-amber-700 ">
                  <li>• Find a quiet space with minimal distractions</li>
                  <li>• Ensure you have 3+ hours available</li>
                  <li>• Have scratch paper and a calculator ready</li>
                  <li>• Close other browser tabs and applications</li>
                </ul>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4">
            <Button size="lg" className="px-12" data-testid="button-start-full-test" disabled>
              <Clock className="h-5 w-5 mr-2" />
              Coming Soon
            </Button>
            <p className="text-sm text-muted-foreground">
              Full-length SAT tests are not yet available. Practice individual sections in the meantime.
            </p>
          </div>
        </PageCard>

        {/* Alternative Options */}
        <div className="grid sm:grid-cols-2 gap-6">
          <PageCard title="Section Practice">
            <p className="text-sm text-muted-foreground mb-4">
              Practice individual sections with timing (32-64 minutes per section)
            </p>
            <div className="flex gap-2 mb-4">
              <Tag variant="muted">Math</Tag>
              <Tag variant="muted">Reading</Tag>
              <Tag variant="muted">Writing</Tag>
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-section-practice">
              <Link href="/practice">
                Practice Sections
              </Link>
            </Button>
          </PageCard>

          <PageCard title="Test History">
            <p className="text-sm text-muted-foreground mb-4">
              View your previous test scores and track your improvement over time
            </p>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-green-600 " />
              <span className="text-sm text-green-600 ">
                +50 points average improvement
              </span>
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-view-scores">
              <Link href="/dashboard">
                View Test History
              </Link>
            </Button>
          </PageCard>
        </div>
      </div>
    </AppShell>
  );
}
