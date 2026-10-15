import { calculatorStateHash } from "@lyceon/shared/calculator-state-hash";

/**
 * @spec [Doc-02B_v4 §14 (resumable sessions), §28 (Desmos); register G-NEW-14 (production logs:
 *       `calculator-state` posts about once a second); owner brief 2026-10-12 ("Calculator state
 *       saves: only when needed")] | @implemented [2026-10-12]
 *
 * plain English: decides WHEN the calculator's state goes to the server. A change only records
 * the latest state locally (`change`); nothing is sent until one of the save moments calls
 * `flush`: leaving or submitting the question, closing the calculator or switching its tab, the
 * page going hidden or closing (sent with `keepalive`), or the safety net, `idleMs` (10 s) after
 * the last change. Every flush is skipped when the state's hash equals the one the server last
 * confirmed, or was seeded with (`seed`, from resume or `/next`), so an unchanged calculator
 * never posts.
 *
 * Sends run one at a time, in order: a flush waits for the send before it and then compares
 * hashes again, so two save moments in a row (Submit, then Next) post once. A flush never
 * rejects; a failed send is reported through `onResult(false)` (the runner shows the UI-10
 * "not saved" notice) and leaves the last-saved hash unchanged, so the next flush tries again.
 *
 * Edge cases: a state that only differs in key order hashes equal (jsonb reorders keys);
 * `dispose` stops the idle timer but does not send — the owner flushes first.
 */
export type CalculatorSendOptions = { keepalive: boolean };

export type CalculatorSaver = {
  /** The calculator changed: remember the state and restart the idle timer. No request. */
  change: (state: unknown) => void;
  /** The server holds this state (resume, `/next`): it counts as saved. */
  seed: (state: unknown) => void;
  /** True if a change has not been confirmed saved yet. */
  hasUnsaved: () => boolean;
  /** True if `state` is the latest state this saver knows of (its own echo). */
  isLatest: (state: unknown) => boolean;
  /** Save the latest state unless the server already holds it. Never rejects. */
  flush: (opts?: Partial<CalculatorSendOptions>) => Promise<void>;
  /** Stop the idle timer. */
  dispose: () => void;
};

export type CalculatorSaverOptions = {
  send: (state: unknown, opts: CalculatorSendOptions) => Promise<void>;
  /** Whether a send may happen at all (e.g. not once the session is over). */
  canSend?: () => boolean;
  onResult?: (ok: boolean) => void;
  idleMs?: number;
};

export const CALCULATOR_IDLE_SAVE_MS = 10_000;

export function createCalculatorSaver(
  options: CalculatorSaverOptions,
): CalculatorSaver {
  const idleMs = options.idleMs ?? CALCULATOR_IDLE_SAVE_MS;
  let latest: { state: unknown; hash: string } | null = null;
  let savedHash: string | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const clearIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const sendLatest = async (keepalive: boolean): Promise<void> => {
    const current = latest;
    if (current === null || current.hash === savedHash) return;
    if (options.canSend && !options.canSend()) return;
    try {
      await options.send(current.state, { keepalive });
    } catch {
      // Reported to the student (UI-10 notice), never logged (Coding Standards §12.1); the
      // hash stays unsaved so the next save moment retries.
      options.onResult?.(false);
      return;
    }
    savedHash = current.hash;
    options.onResult?.(true);
  };

  const flush = (opts?: Partial<CalculatorSendOptions>): Promise<void> => {
    clearIdle();
    const keepalive = opts?.keepalive ?? false;
    queue = queue.then(() => sendLatest(keepalive));
    return queue;
  };

  return {
    change(state) {
      latest = { state, hash: calculatorStateHash(state) };
      clearIdle();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        void flush();
      }, idleMs);
    },
    seed(state) {
      const hash = calculatorStateHash(state);
      savedHash = hash;
      latest = { state, hash };
    },
    hasUnsaved() {
      return latest !== null && latest.hash !== savedHash;
    },
    isLatest(state) {
      return latest !== null && latest.hash === calculatorStateHash(state);
    },
    flush,
    dispose: clearIdle,
  };
}
