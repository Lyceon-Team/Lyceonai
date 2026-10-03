// @vitest-environment jsdom
/**
 * UI-46 shared primitives: render and behaviour tests.
 *
 * @spec [student-UI register UI-46; DESIGN.md §1 "Hierarchy", "Focus and motion", §3; register §2
 *        Keyboard ("Esc closes the open modal or sheet")] | @implemented [2026-10-03]
 *
 * plain English: each primitive is rendered for real (no shallow mocks) inside a `.lyc` root,
 * as a student shell renders it. The variant tests read the class list, because the token
 * classes ARE the contract with student-tokens.css (bg-lyc-primary-bg resolves to
 * var(--primary-bg)); the behaviour tests (Esc, focus return, arrow keys) drive the real Radix
 * primitives with keyboard events.
 */
import { useState, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";
import {
  FullPageLoader,
  Modal,
  ModalClose,
  Notice,
  PageHeader,
  Sheet,
  SheetClose,
} from "@/components/student-ui";

afterEach(cleanup);

function Lyc({ children }: { children: ReactNode }) {
  return <div className="lyc">{children}</div>;
}

function classesOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** A class below the 14px floor: Tailwind's text-xs (12px) or an arbitrary px size under 14. */
function belowFloor(el: Element): string[] {
  return [el, ...Array.from(el.querySelectorAll("*"))].flatMap((node) =>
    classesOf(node).filter(
      (c) => c === "text-xs" || /^text-\[(?:[0-9]|1[0-3])px\]$/.test(c),
    ),
  );
}

describe("cn: the student type scale survives a merge", () => {
  it("keeps a lyc font size next to a lyc colour", () => {
    // Presence: both classes go in. Without the tailwind-merge extension in lib/utils.ts the
    // size is read as a colour and dropped.
    expect(cn("text-lyc-body text-lyc-primary-ink").split(" ")).toEqual([
      "text-lyc-body",
      "text-lyc-primary-ink",
    ]);
  });

  it("lets a later lyc size override an earlier size", () => {
    expect(cn("text-sm text-lyc-body")).toBe("text-lyc-body");
  });
});

describe("Button: student variants", () => {
  it("lyc-primary is a <button> filled with --primary-bg, at the student size", () => {
    render(
      <Lyc>
        <Button variant="lyc-primary">Start today's plan</Button>
      </Lyc>,
    );
    const button = screen.getByRole("button", { name: "Start today's plan" });
    expect(button.tagName).toBe("BUTTON");
    const cls = classesOf(button);
    expect(cls).toEqual(
      expect.arrayContaining([
        "bg-lyc-primary-bg",
        "text-lyc-primary-ink",
        "h-11",
        "text-lyc-body",
      ]),
    );
    // The shadcn 14px size and box-shadow ring are replaced, not stacked.
    expect(cls).not.toContain("text-sm");
    expect(cls).not.toContain("shadow-sm");
    expect(cls).not.toContain("focus-visible:ring-2");
  });

  it("every student variant carries the 3px --focus ring with 2px offset", () => {
    render(
      <Lyc>
        <Button variant="lyc-primary">a</Button>
        <Button variant="lyc-outline">b</Button>
        <Button variant="lyc-quiet">c</Button>
        <Button variant="lyc-link">d</Button>
      </Lyc>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const b of buttons) {
      expect(classesOf(b)).toEqual(
        expect.arrayContaining([
          "focus-visible:outline",
          "focus-visible:outline-[3px]",
          "focus-visible:outline-offset-2",
          "focus-visible:outline-lyc-focus",
          "focus-visible:ring-0",
        ]),
      );
      expect(belowFloor(b)).toEqual([]);
    }
  });

  it("lyc-outline is a 1px --ink-strong border; lyc-link is the only underlined one", () => {
    render(
      <Lyc>
        <Button variant="lyc-outline">Outline</Button>
        <Button variant="lyc-quiet">Quiet</Button>
        <Button variant="lyc-link">Link</Button>
      </Lyc>,
    );
    const outline = classesOf(screen.getByRole("button", { name: "Outline" }));
    expect(outline).toEqual(
      expect.arrayContaining([
        "border",
        "border-lyc-ink-strong",
        "bg-transparent",
      ]),
    );
    expect(outline).not.toContain("border-2");
    expect(outline).not.toContain("underline");
    expect(
      classesOf(screen.getByRole("button", { name: "Quiet" })),
    ).not.toContain("underline");
    expect(classesOf(screen.getByRole("button", { name: "Link" }))).toContain(
      "underline",
    );
  });

  it("the lg size is 52px with 18px text", () => {
    render(
      <Button variant="lyc-primary" size="lyc-lg">
        Start
      </Button>,
    );
    expect(classesOf(screen.getByRole("button"))).toEqual(
      expect.arrayContaining(["h-[52px]", "text-[18px]"]),
    );
  });

  it("existing variants are unchanged for guardian, admin and marketing pages", () => {
    render(<Button>Default</Button>);
    expect(classesOf(screen.getByRole("button"))).toEqual(
      expect.arrayContaining(["bg-primary", "text-sm", "focus-visible:ring-2"]),
    );
  });
});

describe("PageHeader", () => {
  it("renders eyebrow, a serif H1, description and actions", () => {
    render(
      <Lyc>
        <PageHeader
          eyebrow="Monday, 28 September"
          title="Good evening, Ada"
          description="68 days until your SAT."
          titleId="home-title"
          actions={<Button variant="lyc-outline">Edit goals</Button>}
        />
      </Lyc>,
    );
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: "Good evening, Ada",
    });
    expect(h1.id).toBe("home-title");
    expect(classesOf(h1)).toEqual(
      expect.arrayContaining([
        "font-lyc-serif",
        "font-semibold",
        "text-lyc-ink-strong",
        "sm:text-lyc-title",
      ]),
    );
    expect(screen.getByTestId("page-header-eyebrow").textContent).toBe(
      "Monday, 28 September",
    );
    expect(screen.getByTestId("page-header-description").textContent).toBe(
      "68 days until your SAT.",
    );
    expect(
      within(screen.getByTestId("page-header-actions")).getByRole("button", {
        name: "Edit goals",
      }),
    ).toBeInTheDocument();
    expect(belowFloor(screen.getByTestId("page-header"))).toEqual([]);
  });

  it("omits the optional slots when not given", () => {
    render(<PageHeader title="Practice" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page-header-eyebrow")).toBeNull();
    expect(screen.queryByTestId("page-header-description")).toBeNull();
    expect(screen.queryByTestId("page-header-actions")).toBeNull();
  });
});

describe("FullPageLoader", () => {
  it("is a polite status region named by its label, with the label on screen", () => {
    render(<FullPageLoader label="Loading your review session..." />);
    const status = screen.getByRole("status", {
      name: "Loading your review session...",
    });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toBe("Loading your review session...");
    // It brings its own token root and fills the viewport.
    expect(classesOf(status)).toEqual(
      expect.arrayContaining(["lyc", "min-h-screen"]),
    );
  });

  it("does not spin (motion is limited to the LISA dots)", () => {
    render(<FullPageLoader />);
    const status = screen.getByRole("status", { name: "Loading..." });
    const all = [status, ...Array.from(status.querySelectorAll("*"))];
    expect(
      all.flatMap(classesOf).filter((c) => c.startsWith("animate-")),
    ).toEqual([]);
    expect(belowFloor(status)).toEqual([]);
  });

  it("themeLock pins the light set; region fill has no background of its own", () => {
    render(
      <FullPageLoader
        fill="region"
        themeLock="light"
        data-testid="region-loader"
      />,
    );
    const el = screen.getByTestId("region-loader");
    expect(el).toHaveAttribute("data-theme-lock", "light");
    expect(classesOf(el)).toEqual(
      expect.arrayContaining(["min-h-[60vh]", "!bg-transparent"]),
    );
    expect(classesOf(el)).not.toContain("min-h-screen");
  });
});

function ModalHarness({
  onOpenChange,
}: {
  onOpenChange?: (o: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Lyc>
      <Modal
        title="A Tutor That Knows The SAT And Knows You"
        description="LISA is included with every paid plan."
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        trigger={<Button variant="lyc-outline">Open LISA</Button>}
        footer={
          <>
            <Button variant="lyc-primary">See plans</Button>
            <ModalClose asChild>
              <Button variant="lyc-quiet">Not now</Button>
            </ModalClose>
          </>
        }
      />
    </Lyc>
  );
}

describe("Modal", () => {
  it("opens as a dialog labelled by its title, inside a .lyc root, styled with tokens", () => {
    render(<ModalHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open LISA" }));
    const dialog = screen.getByRole("dialog", {
      name: "A Tutor That Knows The SAT And Knows You",
    });
    expect(dialog).toHaveAccessibleDescription(
      "LISA is included with every paid plan.",
    );
    // The portal lands on <body>, outside the page's .lyc root, so it carries its own.
    expect(dialog.closest(".lyc")).not.toBeNull();
    expect(classesOf(dialog)).toEqual(
      expect.arrayContaining([
        "bg-lyc-paper",
        "border-lyc-rule",
        "shadow-none",
      ]),
    );
    expect(classesOf(dialog)).not.toContain("shadow-lg");
    expect(classesOf(dialog)).not.toContain("bg-background");
    const title = within(dialog).getByRole("heading", {
      name: "A Tutor That Knows The SAT And Knows You",
    });
    expect(classesOf(title)).toEqual(
      expect.arrayContaining(["font-lyc-serif", "text-lyc-section"]),
    );
    expect(
      within(dialog).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
    expect(belowFloor(dialog)).toEqual([]);
  });

  it("Esc closes it and focus returns to the button that opened it", async () => {
    const onOpenChange = vi.fn();
    render(<ModalHarness onOpenChange={onOpenChange} />);
    const opener = screen.getByRole("button", { name: "Open LISA" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    // Focus moved into the dialog (the focus trap is live).
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    // Radix restores focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("ModalClose closes it too", () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open LISA" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function SheetHarness() {
  return (
    <Lyc>
      <Sheet
        title="Edit schedule"
        side="right"
        trigger={<Button variant="lyc-outline">Edit schedule</Button>}
        footer={
          <SheetClose asChild>
            <Button variant="lyc-quiet">Done</Button>
          </SheetClose>
        }
      >
        <p>Study days</p>
      </Sheet>
    </Lyc>
  );
}

describe("Sheet", () => {
  it("opens as a labelled dialog with a hairline edge and no shadow", () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
    const sheet = screen.getByRole("dialog", { name: "Edit schedule" });
    expect(sheet.closest(".lyc")).not.toBeNull();
    expect(classesOf(sheet)).toEqual(
      expect.arrayContaining([
        "bg-lyc-paper",
        "border-l",
        "border-lyc-rule",
        "shadow-none",
      ]),
    );
    expect(classesOf(sheet)).not.toContain("shadow-lg");
    expect(within(sheet).getByText("Study days")).toBeInTheDocument();
    expect(belowFloor(sheet)).toEqual([]);
  });

  it("Esc closes it and focus returns to the opener", async () => {
    render(<SheetHarness />);
    const opener = screen.getByRole("button", { name: "Edit schedule" });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole("dialog");
    expect(sheet.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("Tabs: student variant", () => {
  function TabsHarness() {
    return (
      <Lyc>
        <Tabs defaultValue="math">
          <TabsList variant="lyc" aria-label="Section">
            <TabsTrigger value="math">Math</TabsTrigger>
            <TabsTrigger value="rw">Reading and Writing</TabsTrigger>
          </TabsList>
          <TabsContent variant="lyc" value="math">
            Math panel
          </TabsContent>
          <TabsContent variant="lyc" value="rw">
            RW panel
          </TabsContent>
        </Tabs>
      </Lyc>
    );
  }

  it("triggers take the student classes from the list's variant", () => {
    render(<TabsHarness />);
    const list = screen.getByRole("tablist", { name: "Section" });
    expect(classesOf(list)).toEqual(
      expect.arrayContaining(["border-b", "border-lyc-rule"]),
    );
    const math = screen.getByRole("tab", { name: "Math" });
    expect(classesOf(math)).toEqual(
      expect.arrayContaining([
        "text-lyc-body",
        "data-[state=active]:border-lyc-ink-strong",
        "focus-visible:outline-[3px]",
        "focus-visible:outline-lyc-focus",
      ]),
    );
    expect(classesOf(math)).not.toContain("text-sm");
    expect(classesOf(math)).not.toContain("data-[state=active]:shadow-sm");
  });

  it("arrow keys move between tabs and switch the panel", async () => {
    render(<TabsHarness />);
    const math = screen.getByRole("tab", { name: "Math" });
    const rw = screen.getByRole("tab", { name: "Reading and Writing" });
    expect(math).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Math panel");
    math.focus();
    fireEvent.keyDown(math, { key: "ArrowRight" });
    // Radix moves roving focus on the next tick; focusing a tab activates it.
    await waitFor(() => expect(document.activeElement).toBe(rw));
    expect(rw).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel").textContent).toBe("RW panel");
    fireEvent.keyDown(rw, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(math));
    expect(math).toHaveAttribute("aria-selected", "true");
  });

  it("the default variant is unchanged", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(classesOf(screen.getByRole("tablist"))).toContain("bg-secondary");
    expect(classesOf(screen.getByRole("tab"))).toContain("text-sm");
  });
});

describe("Skeleton: student variant", () => {
  it("is a still, decorative --seg-empty block", () => {
    const { container } = render(
      <Skeleton variant="lyc" className="h-6 w-40" />,
    );
    const block = container.firstElementChild;
    expect(block).not.toBeNull();
    if (block === null) return;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(classesOf(block)).toEqual(
      expect.arrayContaining(["bg-lyc-seg-empty", "h-6", "w-40"]),
    );
    expect(classesOf(block)).not.toContain("animate-pulse");
  });

  it("the default variant still pulses", () => {
    const { container } = render(<Skeleton />);
    const block = container.firstElementChild;
    expect(block === null ? [] : classesOf(block)).toContain("animate-pulse");
  });
});

describe("EmptyState: student variant", () => {
  it("renders title, description and an OUTLINE action (the page owns the primary)", () => {
    const onClick = vi.fn();
    render(
      <Lyc>
        <EmptyState
          variant="lyc"
          headingLevel={2}
          title="No sessions yet"
          description="Your practice sessions will appear here."
          action={{ label: "Start practising", onClick }}
        />
      </Lyc>,
    );
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "No sessions yet",
    });
    expect(classesOf(heading)).toEqual(
      expect.arrayContaining(["font-lyc-serif", "text-lyc-ink-strong"]),
    );
    expect(screen.getByTestId("empty-state-description").textContent).toBe(
      "Your practice sessions will appear here.",
    );
    const action = screen.getByRole("button", { name: "Start practising" });
    expect(classesOf(action)).toContain("border-lyc-ink-strong");
    expect(classesOf(action)).not.toContain("bg-lyc-primary-bg");
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
    const root = screen.getByTestId("empty-state");
    expect(classesOf(root)).toEqual(
      expect.arrayContaining(["border-lyc-rule", "bg-lyc-sheet"]),
    );
    expect(belowFloor(root)).toEqual([]);
  });

  it("the default variant still renders the card for UserProfile", () => {
    render(<EmptyState title="No Profile Data" description="d" />);
    expect(screen.getByTestId("empty-state-title").tagName).toBe("DIV");
    expect(screen.getByTestId("empty-state-title").textContent).toBe(
      "No Profile Data",
    );
  });
});

describe("Notice (AppNotice lyc-* variants)", () => {
  it("renders title, message and actions in the student look", () => {
    const onAction = vi.fn();
    render(
      <Lyc>
        <Notice
          tone="info"
          title="Your plan was updated"
          message="Today's plan now has two review blocks."
          actionLabel="See plan"
          onAction={onAction}
          data-testid="notice"
        />
      </Lyc>,
    );
    const notice = screen.getByTestId("notice");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("data-variant", "lyc-info");
    expect(classesOf(notice)).toEqual(
      expect.arrayContaining(["bg-lyc-chip", "shadow-none"]),
    );
    expect(
      within(notice).getByText("Your plan was updated"),
    ).toBeInTheDocument();
    const message = within(notice).getByText(
      "Today's plan now has two review blocks.",
    );
    expect(classesOf(message)).toContain("text-lyc-body");
    expect(classesOf(message)).not.toContain("opacity-90");
    const action = within(notice).getByRole("button", { name: "See plan" });
    expect(classesOf(action)).toContain("border-lyc-ink-strong");
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(belowFloor(notice)).toEqual([]);
  });

  it("danger is an alert in --danger on --danger-bg", () => {
    render(
      <Notice
        tone="danger"
        title="We couldn't save your answer"
        data-testid="notice"
      />,
    );
    const notice = screen.getByRole("alert");
    expect(notice).toBe(screen.getByTestId("notice"));
    expect(classesOf(notice)).toEqual(
      expect.arrayContaining([
        "bg-lyc-danger-bg",
        "text-lyc-danger",
        "border-lyc-danger",
      ]),
    );
  });

  it("a dismissible notice has a named 44px quiet dismiss button", () => {
    const onDismiss = vi.fn();
    render(
      <Notice title="Saved" tone="success" dismissible onDismiss={onDismiss} />,
    );
    const dismiss = screen.getByRole("button", { name: "Dismiss notice" });
    expect(classesOf(dismiss)).toEqual(
      expect.arrayContaining(["h-11", "w-11"]),
    );
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
