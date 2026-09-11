/**
 * What a guardian will see once they link a student — the real shell, no data.
 *
 * @spec [Doc-01_V8 §38 Guardian visibility model; §35 linkage; CLAUDE.md
 *        mastery invariant "earned from observed events only — never infer,
 *        estimate, or invent"] | @implemented [2026-09-03]
 *
 * plain English: renders the guardian dashboard's own panels — progress tiles,
 * domain mastery rows — with every figure replaced by a lock, above a line
 * saying what it is. Expected outcome: a guardian with no linked student sees
 * the shape of what they are being asked to set up, instead of an empty page.
 *
 * STRUCTURAL, NOT SAMPLE — owner ruling 2026-09-03, option 1. The alternative
 * was plausible sample values behind a labelled wrapper. It was refused, and
 * the reason is the invariant above: numbers rendered inside the real dashboard
 * chrome are one CSS regression from reading as a real child's real progress,
 * and no banner survives that. THERE ARE NO NUMERALS IN THIS COMPONENT. That is
 * not a stylistic preference, it is the property a test asserts, and the
 * assertion is an ABSENCE assertion precisely because absence is what can be
 * broken silently.
 *
 * NOT A SECOND DASHBOARD. `GuardianMetricTile` is the SAME component the real
 * progress card renders; only its `locked` variant is used here. A lookalike
 * would drift the first time the real tile changed, and a preview that no
 * longer looks like the product is worse than none.
 *
 * ONLY IN THE NO-LINKED-STUDENT STATE. Once a guardian has a link, the
 * dashboard has that student's name and real panels to show, and showing this
 * instead would be a downgrade. `guardian-dashboard.tsx` renders it under
 * `students.length === 0` and nowhere else.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, Eye, Lock, Target } from "lucide-react";
import { GuardianMetricTile } from "./GuardianMetricTile";

/** The domains the real mastery panel lists, in the order it lists them. */
const PREVIEW_DOMAIN_LABELS = [
  "Algebra",
  "Advanced Math",
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry",
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions",
] as const;

export function GuardianTemplatePreview() {
  return (
    <div className="space-y-6" data-testid="guardian-template-preview">
      <Alert className="border-[#0F2E48]/20 bg-[#0F2E48]/5">
        <Eye className="h-4 w-4 text-[#0F2E48]" />
        <AlertDescription className="text-[#0F2E48]">
          <span className="font-medium">
            This is what you&apos;ll see once you link a student.
          </span>{" "}
          <span className="text-[#0F2E48]/80">
            Nothing below is real data — the figures stay locked until a student
            shares their code with you.
          </span>
        </AlertDescription>
      </Alert>

      <Card className="bg-card border-border/60 opacity-90">
        <CardHeader>
          <CardTitle className="text-[#0F2E48]">Student Progress</CardTitle>
          <CardDescription>
            Their activity in the last 7 days, once they are linked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <GuardianMetricTile
              locked
              label="Day Streak"
              icon={<Clock className="h-5 w-5" />}
            />
            <GuardianMetricTile
              locked
              label="Questions Attempted (7d)"
              icon={<Target className="h-5 w-5" />}
            />
            <GuardianMetricTile locked label="Accuracy" icon="%" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border/60 opacity-90">
        <CardHeader>
          <CardTitle className="text-[#0F2E48]">Domain Mastery</CardTitle>
          <CardDescription>
            Where their answers place them in each domain. Guardian surfaces are
            domain-level only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PREVIEW_DOMAIN_LABELS.map((domain) => (
              <div
                key={domain}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/35 p-3"
              >
                <span className="text-sm font-medium text-[#0F2E48]">
                  {domain}
                </span>
                <Lock
                  className="h-4 w-4 text-[#0F2E48]/35"
                  aria-label={`${domain} — locked`}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
