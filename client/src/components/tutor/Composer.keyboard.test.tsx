// @vitest-environment jsdom
/**
 * @spec [student-UI register §2 Keyboard (LISA row), UI-45; DESIGN.md §3]
 * @implemented [2026-10-03]
 *
 * plain English: the LISA composer (shared by /chat and the in-review panel) through the
 * real component: Enter sends; Shift+Enter adds a new line (the textarea keeps its default
 * and nothing is sent); Enter while an IME is composing sends nothing; nothing is sent while
 * LISA is thinking or the draft is blank; Enter typed into some other field does not send.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./TutorThreadParts";

afterEach(() => {
  cleanup();
});

function ComposerHarness({
  onSubmit,
  disabled = false,
  initial = "What is a linear function?",
}: {
  onSubmit: () => void;
  disabled?: boolean;
  initial?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <input aria-label="Elsewhere" />
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={onSubmit}
        disabled={disabled}
        placeholder="Ask LISA"
      />
    </>
  );
}

function keydown(
  el: Element,
  init: KeyboardEventInit,
): { event: KeyboardEvent } {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return { event };
}

describe("LISA composer keys (§2 row 3)", () => {
  it("Enter sends, and does not also insert a newline", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    const { event } = keydown(screen.getByLabelText("Message"), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+Enter adds a new line: nothing sent, the textarea keeps its default", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    const { event } = keydown(screen.getByLabelText("Message"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Enter while an IME is composing sends nothing", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    const box = screen.getByLabelText("Message");
    keydown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a blank draft sends nothing (and gets no stray newline)", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} initial="   " />);
    const { event } = keydown(screen.getByLabelText("Message"), {
      key: "Enter",
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("nothing is sent while LISA is thinking", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} disabled />);
    keydown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter typed in another field does not send", () => {
    const onSubmit = vi.fn();
    render(<ComposerHarness onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText("Elsewhere"), { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows no keystroke hint text (DESIGN.md §3, Karl's ruling)", () => {
    render(<ComposerHarness onSubmit={vi.fn()} />);
    expect(document.body.textContent ?? "").not.toMatch(
      /shift|enter to|press enter|new line/i,
    );
  });
});
