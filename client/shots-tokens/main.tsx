/**
 * Gallery for the `--primary` token defect — NOT shipped.
 *
 * @spec [owner decision 2026-11-03: "Fix the token app-wide, remove the per-component
 *        workarounds, and include before-and-after screenshots of every page with a
 *        default-variant button."] | @implemented [2026-11-03]
 *
 * plain English: renders every surface the token actually reaches — the real `Button` in each
 * variant, the real `Badge`, the real `Checkbox`, the bare `bg-primary` utilities the guardian
 * pages use inline, and the focus outline `accessibility.css` draws — in both themes, so a
 * before-and-after pair shows exactly what the fix changes and what it leaves alone.
 *
 * WHY A GALLERY AND NOT THE PAGES THEMSELVES. "Every page with a default-variant button" cannot
 * be driven from here: those pages are behind Supabase auth and a live API, and a screenshot of
 * a login wall would prove nothing. What the defect touches is not a page, it is these few
 * primitives — `bg-primary`, `bg-primary/10`, `text-primary-foreground`, and the one
 * `hsl(var(--primary))` in `accessibility.css`. Every affected page renders one of them, and the
 * call sites are listed beside each row so a reviewer can check the mapping rather than take it
 * on trust.
 */
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import "@/index.css";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

/** Where each row is rendered in the real app, so the mapping can be checked, not assumed. */
const CALL_SITES: ReadonlyArray<readonly [string, string]> = [
  [
    "Button variant=default (bg-primary)",
    "GuardianStudentsPage “Manage billing”; every <Button> with no variant prop; AlertDialogAction's default",
  ],
  ["Badge variant=default", "ui/badge.tsx — bg-primary"],
  ["Checkbox checked", "ui/checkbox.tsx — data-[state=checked]:bg-primary"],
  [
    "bg-primary (inline)",
    "GuardianStates.tsx:186, GuardianScoreStrip.tsx:117/178, GuardianWeekPlan.tsx:57/76, NotificationBell.tsx:77, CookieConsentRoot.tsx:391, FeedbackDialog.tsx:89",
  ],
  [
    "bg-primary/10 (alpha) — SEPARATE FINDING, unchanged by this PR",
    "pages/trust.tsx:37, :298, :328. Tailwind generates NO utility at all for an alpha on a plain var() colour, so this row is blank before and after. Same for bg-secondary/60, bg-muted/50, hover:bg-destructive/90 and ~17 other sites. Fixing it means converting the whole shadcn palette to an alpha-capable form — its own change, its own review.",
  ],
  [
    "focus-visible outline",
    "styles/accessibility.css:2 — hsl(var(--primary, …)) on every button, link and input",
  ],
];

function Row({ label, note, children }: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        gap: 20,
        alignItems: "center",
        padding: "18px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{label}</div>
        <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>{note}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {children}
      </div>
    </section>
  );
}

const params = new URLSearchParams(window.location.search);
const dark = params.get("theme") === "dark";
if (dark) document.documentElement.classList.add("dark");

const mount = document.getElementById("root");
if (mount === null) throw new Error("no #root");

createRoot(mount).render(
  <div
    style={{
      minHeight: "100vh",
      padding: 40,
      background: "var(--background)",
      color: "var(--foreground)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    }}
  >
    <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>
      {`--primary token — ${dark ? "dark" : "light"} theme`}
    </h1>
    <p style={{ margin: "0 0 20px", fontSize: 14, opacity: 0.7 }}>
      Every surface the token reaches. A transparent fill with pale text means the
      declaration is invalid.
    </p>

    <Row label={CALL_SITES[0]![0]} note={CALL_SITES[0]![1]}>
      {BUTTON_VARIANTS.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </Row>

    <Row label={CALL_SITES[1]![0]} note={CALL_SITES[1]![1]}>
      <Badge>default</Badge>
      <Badge variant="secondary">secondary</Badge>
      <Badge variant="destructive">destructive</Badge>
      <Badge variant="outline">outline</Badge>
    </Row>

    <Row label={CALL_SITES[2]![0]} note={CALL_SITES[2]![1]}>
      <Checkbox checked />
      <Checkbox />
    </Row>

    <Row label={CALL_SITES[3]![0]} note={CALL_SITES[3]![1]}>
      <span className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
        bg-primary
      </span>
      <span className="inline-block h-9 w-24 rounded-full bg-primary" />
    </Row>

    <Row label={CALL_SITES[4]![0]} note={CALL_SITES[4]![1]}>
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        10%
      </span>
      <span className="rounded-md bg-primary/10 px-4 py-2">tinted panel</span>
    </Row>

    <Row label={CALL_SITES[5]![0]} note={CALL_SITES[5]![1]}>
      {/* autoFocus so the screenshot carries the :focus-visible outline without a click. */}
      <Button variant="outline" autoFocus>
        focused
      </Button>
    </Row>
  </div>,
);
