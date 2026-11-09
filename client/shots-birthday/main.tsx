/**
 * Screenshot harness for the three-field birthday input.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04): "screenshots of the new input on
 *       desktop and at 375px wide, including the confirmation line and an error state"]
 *       | @implemented [2026-11-04]
 *
 * plain English: mounts the REAL `BirthdayFields` inside the real `.lyc` root the onboarding page
 * gives it, in the three states worth photographing. `today` is pinned so the placeholder year and
 * the age rules are the same in every run and the images are comparable.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BirthdayFields } from "@/components/profile/BirthdayFields";
import { EMPTY_BIRTHDAY, type BirthdayParts } from "@lyceon/shared/birthday";
import "@/index.css";
// student-tokens.css is imported by App.tsx in the real app, NOT by index.css. Without it the
// `.lyc` tokens are absent, `--muted` falls through to shadcn's muted BACKGROUND (#F0EAE0) and
// `--danger` is undefined entirely — which photographed the confirmation line as near-white on
// cream and the errors as navy. Measured, not assumed: the same token-collision defect that
// `--primary` had app-wide (#1433).
import "@/styles/student-tokens.css";

const TODAY = new Date("2026-11-04T12:00:00Z");

function Case({
  title,
  initial,
  showAllErrors,
  variant = "lyc",
}: {
  title: string;
  initial: BirthdayParts;
  showAllErrors: boolean;
  variant?: "lyc" | "default";
}): JSX.Element {
  const [value, setValue] = useState<BirthdayParts>(initial);
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          font: "600 13px/1.4 ui-sans-serif, system-ui",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          opacity: 0.55,
          margin: "0 0 10px",
        }}
      >
        {title}
      </h2>
      <BirthdayFields
        value={value}
        onChange={setValue}
        showAllErrors={showAllErrors}
        variant={variant}
        today={TODAY}
      />
    </section>
  );
}

function App(): JSX.Element {
  return (
    // The same root the onboarding page renders under (BareCardShell), so the tokens resolve.
    <div
      className="lyc"
      style={{ background: "var(--paper)", minHeight: "100vh" }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: 24,
          background: "var(--sheet)",
        }}
      >
        <Case
          title="Empty — all three fields, placeholders only"
          initial={EMPTY_BIRTHDAY}
          showAllErrors={false}
        />
        <Case
          title="Filled — the confirmation line"
          initial={{ month: "4", day: "4", year: "2006" }}
          showAllErrors={false}
        />
        <Case
          title="Error — submitted with nothing entered"
          initial={EMPTY_BIRTHDAY}
          showAllErrors
        />
        <Case
          title="Error — the current year (the reported bug)"
          initial={{ month: "4", day: "4", year: "2026" }}
          showAllErrors
        />
        <Case
          title="Error — a day that does not exist"
          initial={{ month: "2", day: "30", year: "2006" }}
          showAllErrors
        />
      </div>
      {/*
       * The guardian "Add student" dialog: OUTSIDE the `.lyc` root, on the default variant —
       * the surface where the student tokens would not resolve.
       */}
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: 24,
          background: "var(--card, #fff)",
        }}
      >
        <Case
          title="Guardian dialog (default variant) — filled"
          initial={{ month: "1", day: "1", year: "1980" }}
          showAllErrors={false}
          variant="default"
        />
        <Case
          title="Guardian dialog (default variant) — errors"
          initial={EMPTY_BIRTHDAY}
          showAllErrors
          variant="default"
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
