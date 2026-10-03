// @vitest-environment jsdom
/**
 * @spec [student-UI register §2 Keyboard, UI-45; DESIGN.md §3] | @implemented [2026-10-03]
 *
 * plain English: the shared hook's own guarantees — one listener per mount, removed on
 * unmount; text fields, dialogs, focused controls, modifiers, repeats and IME composition
 * are ignored unless a binding lists them; and each surface's keymap builder in isolation
 * (the surfaces' page-level tests drive the same builders through the real pages).
 */
import React, { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEscapeKeymap,
  buildExamModuleKeymap,
  buildLisaComposerKeymap,
  buildRunnerKeymap,
  useKeyboardShortcuts,
  type Keymap,
  type KeyboardShortcutOptions,
  type RunnerKeymapInput,
} from "./useKeyboardShortcuts";
import { GRID_IN_INPUT_ID } from "@/components/practice/NumericEntryInput";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({
  keymap,
  options,
  children,
}: {
  keymap: Keymap;
  options?: KeyboardShortcutOptions;
  children?: React.ReactNode;
}): React.ReactElement {
  useKeyboardShortcuts(keymap, options);
  return <div>{children}</div>;
}

function TargetHarness({ keymap }: { keymap: Keymap }): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useKeyboardShortcuts(keymap, { target: ref });
  return (
    <>
      <textarea ref={ref} data-testid="scoped" />
      <textarea data-testid="elsewhere" />
    </>
  );
}

function keydownRegistrations(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter(([type]) => type === "keydown").length;
}

describe("useKeyboardShortcuts — listener lifecycle", () => {
  it("adds exactly one keydown listener, however often the keymap changes", () => {
    const add = vi.spyOn(window, "addEventListener");
    const run = vi.fn();
    const { rerender } = render(<Harness keymap={[{ key: "Enter", run }]} />);
    rerender(<Harness keymap={[{ key: "Enter", run }]} />);
    rerender(
      <Harness keymap={[{ key: "Enter", run }]} options={{ enabled: false }} />,
    );
    expect(keydownRegistrations(add)).toBe(1);
  });

  it("uses the latest keymap without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Harness keymap={[{ key: "Enter", run: first }]} />,
    );
    rerender(<Harness keymap={[{ key: "Enter", run: second }]} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // The register row's own proof: deleting the hook's removeEventListener turns this red.
  it("removes its listener on unmount: a key after unmount reaches no binding", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const run = vi.fn();
    const { unmount } = render(<Harness keymap={[{ key: "Enter", run }]} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(keydownRegistrations(remove)).toBe(1);
  });

  it("removes a target-scoped listener from that element on unmount", () => {
    const run = vi.fn();
    const { getByTestId, unmount } = render(
      <TargetHarness
        keymap={buildLisaComposerKeymap({ canSend: true, onSend: run })}
      />,
    );
    const scoped = getByTestId("scoped");
    unmount();
    fireEvent.keyDown(scoped, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });

  it("enabled: false suspends every binding", () => {
    const run = vi.fn();
    render(
      <Harness keymap={[{ key: "Enter", run }]} options={{ enabled: false }} />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts — what it ignores", () => {
  it("ignores a key typed into a text field elsewhere on the page", () => {
    const run = vi.fn();
    const { getByTestId } = render(
      <Harness
        keymap={[
          { key: "Enter", run },
          { key: "ArrowDown", run },
        ]}
      >
        <input data-testid="text" type="text" />
        <textarea data-testid="area" />
        <select data-testid="select" />
        <div data-testid="rich" contentEditable suppressContentEditableWarning>
          x
        </div>
      </Harness>,
    );
    for (const id of ["text", "area", "select", "rich"]) {
      fireEvent.keyDown(getByTestId(id), { key: "Enter" });
      fireEvent.keyDown(getByTestId(id), { key: "ArrowDown" });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("lets a binding through from the text field it lists, and only that one", () => {
    const run = vi.fn();
    const { getByTestId } = render(
      <Harness
        keymap={[
          { key: "Enter", allowInTextFields: (el) => el.id === "listed", run },
        ]}
      >
        <input id="listed" data-testid="listed" />
        <input id="other" data-testid="other" />
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("other"), { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId("listed"), { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores modifiers the binding did not ask for", () => {
    const run = vi.fn();
    render(<Harness keymap={[{ key: "Enter", run }]} />);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { key: "Enter", altKey: true });
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores key repeats and IME composition", () => {
    const run = vi.fn();
    render(<Harness keymap={[{ key: "Enter", run }]} />);
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "Enter", isComposing: true });
    fireEvent.keyDown(window, { key: "Enter", keyCode: 229 });
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores an event another handler already handled", () => {
    const run = vi.fn();
    const { getByTestId } = render(
      <Harness keymap={[{ key: "Enter", run }]}>
        <div data-testid="eater" onKeyDown={(e) => e.preventDefault()} />
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("eater"), { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves Enter on a focused button to the button, and arrows to a widget that owns them", () => {
    const run = vi.fn();
    const { getByTestId } = render(
      <Harness
        keymap={[
          { key: "Enter", run },
          { key: "ArrowRight", run },
        ]}
      >
        <button type="button" data-testid="btn">
          Skip
        </button>
        <div role="tablist">
          <button type="button" role="tab" data-testid="tab">
            Tab
          </button>
        </div>
        <div role="separator" tabIndex={0} data-testid="sep" />
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("btn"), { key: "Enter" });
    fireEvent.keyDown(getByTestId("tab"), { key: "ArrowRight" });
    fireEvent.keyDown(getByTestId("sep"), { key: "ArrowRight" });
    expect(run).not.toHaveBeenCalled();
    // An arrow on a plain button is not the button's key: it still reaches the binding.
    fireEvent.keyDown(getByTestId("btn"), { key: "ArrowRight" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores keys from inside a dialog unless the binding allows it", () => {
    const pageKey = vi.fn();
    const close = vi.fn();
    const { getByTestId } = render(
      <Harness
        keymap={[
          { key: "ArrowRight", run: pageKey },
          ...buildEscapeKeymap(close),
        ]}
      >
        <div role="dialog">
          <span data-testid="inside" tabIndex={-1} />
        </div>
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("inside"), { key: "ArrowRight" });
    expect(pageKey).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId("inside"), { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a run() returning false leaves the browser default alone; a handled key prevents it", () => {
    render(
      <Harness
        keymap={[
          { key: "ArrowDown", run: () => false },
          { key: "ArrowUp", run: () => true },
        ]}
      />,
    );
    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
    });
    const up = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
    });
    window.dispatchEvent(down);
    window.dispatchEvent(up);
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(true);
  });
});

describe("keymap builders", () => {
  function runnerInput(
    over: Partial<RunnerKeymapInput> = {},
  ): RunnerKeymapInput {
    return {
      phase: "answering",
      busy: false,
      optionIds: ["a", "b", "c"],
      selectedOptionId: null,
      canSubmit: false,
      onSelectOption: vi.fn(),
      onSubmit: vi.fn(),
      onNext: vi.fn(),
      ...over,
    };
  }

  it("runner: grid-in Enter is let through from the grid-in box only", () => {
    const input = runnerInput({ optionIds: [], canSubmit: true });
    const { getByTestId } = render(
      <Harness keymap={buildRunnerKeymap(input)}>
        <input id={GRID_IN_INPUT_ID} data-testid="grid" />
        <input data-testid="other" />
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("other"), { key: "Enter" });
    expect(input.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId("grid"), { key: "Enter" });
    expect(input.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("runner: ↑/↓ stop at the ends; nothing happens while busy", () => {
    const last = runnerInput({ selectedOptionId: "c" });
    const { unmount } = render(<Harness keymap={buildRunnerKeymap(last)} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(last.onSelectOption).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(last.onSelectOption).toHaveBeenCalledWith("b");
    unmount();

    const busy = runnerInput({
      busy: true,
      selectedOptionId: "a",
      canSubmit: true,
    });
    render(<Harness keymap={buildRunnerKeymap(busy)} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(busy.onSelectOption).not.toHaveBeenCalled();
    expect(busy.onSubmit).not.toHaveBeenCalled();
  });

  it("exam: the keymap has no Enter binding at all", () => {
    const keymap = buildExamModuleKeymap({
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    });
    expect(keymap.map((b) => b.key).sort()).toEqual([
      "ArrowLeft",
      "ArrowRight",
    ]);
  });

  it("LISA: Enter sends; Shift+Enter is left to the textarea (no send, default kept)", () => {
    const send = vi.fn();
    const { getByTestId } = render(
      <TargetHarness
        keymap={buildLisaComposerKeymap({ canSend: true, onSend: send })}
      />,
    );
    const shiftEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    getByTestId("scoped").dispatchEvent(shiftEnter);
    expect(send).not.toHaveBeenCalled();
    expect(shiftEnter.defaultPrevented).toBe(false);

    fireEvent.keyDown(getByTestId("elsewhere"), { key: "Enter" });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(getByTestId("scoped"), { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("Esc: closes even from a text field inside the overlay", () => {
    const close = vi.fn();
    const { getByTestId } = render(
      <Harness keymap={buildEscapeKeymap(close)}>
        <input data-testid="field" />
      </Harness>,
    );
    fireEvent.keyDown(getByTestId("field"), { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Esc with stopPropagation: a target-scoped Esc never reaches outer listeners", () => {
    // A plain window listener stands for any outer Esc handler that is not this hook (a
    // second hook would skip the event anyway, because it arrives defaultPrevented).
    const close = vi.fn();
    const outerEsc = vi.fn();
    window.addEventListener("keydown", outerEsc);
    function Scoped(): React.ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useKeyboardShortcuts(
        buildEscapeKeymap(close, { stopPropagation: true }),
        {
          target: ref,
        },
      );
      return <div ref={ref} tabIndex={-1} data-testid="panel" />;
    }
    try {
      const { getByTestId } = render(<Scoped />);
      fireEvent.keyDown(getByTestId("panel"), { key: "Escape" });
      expect(close).toHaveBeenCalledTimes(1);
      expect(outerEsc).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEsc);
    }
  });
});
