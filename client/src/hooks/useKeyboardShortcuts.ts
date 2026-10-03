/**
 * @spec [student-UI register §2 Keyboard, UI-45; DESIGN.md §3 (Keyboard hook), §4 (Question
 *        runner keys)] | @implemented [2026-10-03]
 *
 * plain English: the ONE keyboard hook for the student surfaces, plus one keymap builder per
 * surface in the §2 table. A surface builds a keymap (a list of bindings) from its current
 * state and hands it to `useKeyboardShortcuts`; the hook adds a single `keydown` listener on
 * mount (on `window`, or on `options.target` when given) and removes it on unmount. The keymap
 * and `enabled` are read through a ref, so re-renders never re-subscribe.
 *
 * What the hook ignores, before any binding is consulted (§2: "The hook ignores keys typed
 * into text fields except where listed, and removes its listener on unmount"):
 *   - events another handler already handled (`defaultPrevented`);
 *   - key repeats (a held key acts once) and IME composition (`isComposing`, or the legacy
 *     229 keyCode Safari still sends) — Enter that confirms a composed character is not a send;
 *   - a modifier the binding did not ask for (Ctrl+Enter is not Enter);
 *   - keys typed into a text field (input / textarea / select / contenteditable) unless the
 *     binding lists that field (`allowInTextFields`) — the runner's grid-in box and the LISA
 *     composer are the two listed cases;
 *   - Enter on a focused button or link, and arrows on a widget that owns its arrows (tabs,
 *     radio groups, listboxes, sliders, the resizable separator), unless the binding allows it
 *     (`allowOnControls`) — the focused control's native action wins;
 *   - events from inside a dialog (`role="dialog"`/`"alertdialog"`) unless the binding allows
 *     it (`allowInDialogs`) — an open Radix dialog keeps the page's keys away from the page.
 *
 * No surface renders keystroke hint text (DESIGN.md §3, Karl's ruling); this module adds none.
 *
 * Esc: Radix `Dialog`, `Sheet` and `AlertDialog` (components/ui/dialog, sheet, alert-dialog)
 * already close on Esc through Radix's DismissableLayer — they must NOT also take
 * `buildEscapeKeymap`, or one press would close twice. The Esc builder is for overlays that
 * are not Radix (ReconsentModal, the calendar SetupPopup, the exam calculator FloatingPanel).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { GRID_IN_INPUT_ID } from "@/components/practice/NumericEntryInput";

/** The keys the §2 table binds. Extending it is a deliberate change, not a free string. */
export type ShortcutKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Enter"
  | "Escape";

export type KeyBinding = {
  key: ShortcutKey;
  /** Required modifier state. Omitted means "must NOT be held". */
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  /** Fire even when focus is in a text field — only for the cases §2 lists. */
  allowInTextFields?: boolean | ((field: HTMLElement) => boolean);
  /** Fire even when focus is on a control that owns this key natively. */
  allowOnControls?: boolean | ((control: HTMLElement) => boolean);
  /** Fire even when the event comes from inside a dialog. */
  allowInDialogs?: boolean;
  /** Stop the event bubbling past the listener's target once handled. */
  stopPropagation?: boolean;
  /**
   * Runs the action. Return `false` for "nothing to do here" — the event is then left
   * untouched (default not prevented) so the browser's own behaviour still happens.
   */
  run: (event: KeyboardEvent) => boolean | void;
};

export type Keymap = ReadonlyArray<KeyBinding>;

export type KeyboardShortcutOptions = {
  /** False suspends every binding without removing the listener. Default true. */
  enabled?: boolean;
  /** Listen on this element instead of `window` (the LISA composer, a floating panel). */
  target?: RefObject<HTMLElement | null>;
};

/** Marks a practice/review option button: Enter on it submits the selection (§2). */
export const RUNNER_OPTION_ATTR = "data-runner-option";

const TEXT_INPUT_EXEMPT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const ENTER_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "input",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
].join(",");

const ARROW_OWNER_SELECTOR = [
  '[role="tablist"]',
  '[role="tab"]',
  '[role="radiogroup"]',
  '[role="radio"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[role="separator"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="tree"]',
  '[role="grid"]',
  'input[type="range"]',
  'input[type="radio"]',
].join(",");

const DIALOG_SELECTOR = '[role="dialog"],[role="alertdialog"]';

function isTextField(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLInputElement) {
    return !TEXT_INPUT_EXEMPT_TYPES.has(el.type);
  }
  return (
    el.isContentEditable === true ||
    el.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

function controlOwningKey(
  el: HTMLElement,
  key: ShortcutKey,
): HTMLElement | null {
  if (key === "Enter") return el.closest<HTMLElement>(ENTER_CONTROL_SELECTOR);
  if (key === "Escape") return null;
  return el.closest<HTMLElement>(ARROW_OWNER_SELECTOR);
}

function permits(
  rule: boolean | ((el: HTMLElement) => boolean) | undefined,
  el: HTMLElement,
): boolean {
  if (typeof rule === "function") return rule(el);
  return rule === true;
}

function modifiersMatch(binding: KeyBinding, event: KeyboardEvent): boolean {
  return (
    event.shiftKey === (binding.shift ?? false) &&
    event.altKey === (binding.alt ?? false) &&
    event.ctrlKey === (binding.ctrl ?? false) &&
    event.metaKey === (binding.meta ?? false)
  );
}

/** Whether `binding` may act on `event`, given where the event came from. Pure. */
function bindingApplies(binding: KeyBinding, event: KeyboardEvent): boolean {
  if (event.key !== binding.key || !modifiersMatch(binding, event))
    return false;
  const origin = event.target;
  if (!(origin instanceof HTMLElement)) return true;
  if (isTextField(origin) && !permits(binding.allowInTextFields, origin)) {
    return false;
  }
  const control = controlOwningKey(origin, binding.key);
  if (
    control !== null &&
    !isTextField(control) &&
    !permits(binding.allowOnControls, control)
  ) {
    return false;
  }
  if (
    origin.closest(DIALOG_SELECTOR) !== null &&
    binding.allowInDialogs !== true
  ) {
    return false;
  }
  return true;
}

/** Runs the first binding that applies; a binding returning false stops the search untouched. */
function dispatchKeymap(keymap: Keymap, event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat) return;
  // 229: Safari reports the keydown that ends an IME composition with isComposing=false.
  if (event.isComposing || event.keyCode === 229) return;
  for (const binding of keymap) {
    if (!bindingApplies(binding, event)) continue;
    if (binding.run(event) === false) return;
    event.preventDefault();
    if (binding.stopPropagation === true) event.stopPropagation();
    return;
  }
}

/**
 * The shared hook. One listener per mounted caller, added once, removed on unmount.
 */
export function useKeyboardShortcuts(
  keymap: Keymap,
  options: KeyboardShortcutOptions = {},
): void {
  const keymapRef = useRef<Keymap>(keymap);
  const enabledRef = useRef<boolean>(options.enabled ?? true);
  useLayoutEffect(() => {
    keymapRef.current = keymap;
    enabledRef.current = options.enabled ?? true;
  });

  const target = options.target;
  useEffect(() => {
    const host: HTMLElement | Window | null =
      target === undefined ? window : target.current;
    if (host === null) return undefined;
    const onKeyDown = (event: Event): void => {
      if (!enabledRef.current || !(event instanceof KeyboardEvent)) return;
      dispatchKeymap(keymapRef.current, event);
    };
    host.addEventListener("keydown", onKeyDown);
    return () => host.removeEventListener("keydown", onKeyDown);
  }, [target]);
}

// ---------------------------------------------------------------------------
// Keymap builders — one per surface in the §2 table
// ---------------------------------------------------------------------------

export type RunnerKeymapInput = {
  /** "answering" before submit; "feedback" once the result is on screen. */
  phase: "answering" | "feedback";
  /** True while a submit, load or end-session is in flight: every key waits. */
  busy: boolean;
  /** Option ids in on-screen order. Empty for a grid-in question. */
  optionIds: ReadonlyArray<string>;
  selectedOptionId: string | null;
  /** The same gate the submit button uses (an option chosen / a valid grid-in value). */
  canSubmit: boolean;
  onSelectOption: (optionId: string) => void;
  onSubmit: () => void;
  /** What the feedback-state primary button does (next question, or finish on the last). */
  onNext: () => void;
};

function isRunnerSubmitControl(el: HTMLElement): boolean {
  return el.closest(`[${RUNNER_OPTION_ATTR}]`) !== null;
}

function isGridInField(el: HTMLElement): boolean {
  return el.id === GRID_IN_INPUT_ID;
}

/**
 * Practice and review runner (§2 row 1; DESIGN.md §4): ↑/↓ move between options; Enter
 * submits the selected option, or the typed grid-in answer from its box; after feedback,
 * Enter or → goes to the next question. Enter with nothing submittable does nothing.
 */
export function buildRunnerKeymap(input: RunnerKeymapInput): Keymap {
  const { phase, busy, optionIds, selectedOptionId } = input;

  const move = (step: 1 | -1): boolean => {
    if (phase !== "answering" || busy || optionIds.length === 0) return false;
    const at =
      selectedOptionId === null ? -1 : optionIds.indexOf(selectedOptionId);
    const nextIndex =
      at === -1 ? 0 : Math.min(optionIds.length - 1, Math.max(0, at + step));
    const nextId = optionIds[nextIndex];
    if (nextId === undefined) return false;
    if (nextId !== selectedOptionId) input.onSelectOption(nextId);
    return true;
  };

  const next = (): boolean => {
    if (phase !== "feedback" || busy) return false;
    input.onNext();
    return true;
  };

  return [
    { key: "ArrowDown", run: () => move(1) },
    { key: "ArrowUp", run: () => move(-1) },
    {
      key: "Enter",
      allowInTextFields: isGridInField,
      allowOnControls: isRunnerSubmitControl,
      run: () => {
        if (phase === "feedback") return next();
        if (busy || !input.canSubmit) return false;
        input.onSubmit();
        return true;
      },
    },
    { key: "ArrowRight", run: next },
  ];
}

export type ExamModuleKeymapInput = {
  /** What the footer Back button does; null when there is no earlier question. */
  onPrevious: (() => void) | null;
  /** What the footer Next button does; null when there is nothing after (review screen). */
  onNext: (() => void) | null;
};

/**
 * Timed exam module (§2 row 2): ← / → move between questions, mirroring the footer Back and
 * Next buttons. There is deliberately NO Enter binding: Enter on a focused choice selects it
 * through the button's own activation, and nothing here can reach module submit — that stays
 * behind SubmitModuleDialog's confirmation.
 */
export function buildExamModuleKeymap(input: ExamModuleKeymapInput): Keymap {
  const { onPrevious, onNext } = input;
  return [
    {
      key: "ArrowLeft",
      run: () => {
        if (onPrevious === null) return false;
        onPrevious();
        return true;
      },
    },
    {
      key: "ArrowRight",
      run: () => {
        if (onNext === null) return false;
        onNext();
        return true;
      },
    },
  ];
}

export type LisaComposerKeymapInput = {
  /** False while LISA is thinking or the draft is blank. */
  canSend: boolean;
  onSend: () => void;
};

/**
 * LISA composer (§2 row 3): Enter sends; Shift+Enter adds a new line. Use with
 * `{ target: composerRef }` — the binding is for the composer textarea only. Shift+Enter is
 * not bound, so the textarea inserts its newline natively. Enter on a blank draft is still
 * consumed (no stray newline) but sends nothing.
 */
export function buildLisaComposerKeymap(
  input: LisaComposerKeymapInput,
): Keymap {
  return [
    {
      key: "Enter",
      allowInTextFields: true,
      allowInDialogs: true,
      run: () => {
        if (input.canSend) input.onSend();
        return true;
      },
    },
  ];
}

export type EscapeKeymapOptions = {
  /** Stop Esc reaching outer layers (a floating panel above a page with its own Esc). */
  stopPropagation?: boolean;
};

/**
 * Esc closes the open modal or sheet (§2 row 4) — for NON-Radix overlays only. Radix Dialog,
 * Sheet and AlertDialog already close on Esc; do not add this to them.
 */
export function buildEscapeKeymap(
  onClose: () => void,
  options: EscapeKeymapOptions = {},
): Keymap {
  return [
    {
      key: "Escape",
      allowInTextFields: true,
      allowInDialogs: true,
      ...(options.stopPropagation === true ? { stopPropagation: true } : {}),
      run: () => {
        onClose();
      },
    },
  ];
}
