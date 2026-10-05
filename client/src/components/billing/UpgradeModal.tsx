/**
 * The app's one upgrade modal, and the one place a refused request opens it.
 *
 * @spec [student-UI register UI-44; §2 Free versus paid (rail locks, ruling 3 calendar exception,
 *        ruling 1 / SCL-185 denial contract, OQ-5 lapsed report); OQ-29 (age message, not the
 *        upgrade modal); OQ-39(e) ("See plans" → Settings → Billing); DESIGN.md §3 "Upgrade
 *        modal"] | @implemented [2026-10-03]
 *
 * plain English: `UpgradeModalProvider` is mounted once at the app root, inside the
 * QueryClientProvider. It renders a single student `Modal` and exposes `useUpgradeModal()`,
 * whose `open(feature, reason)` the rail's locked items (UI-41), the locked cards and an
 * explicit caller (the lapsed exam report's `renew_entitlement`, UI-54) use. Reason `plan` shows
 * the feature's upgrade copy with "See plans" (to Settings → Billing) and "Not now"; reason `age`
 * shows the age message with no plans button (OQ-29).
 *
 * AUTO-OPEN ON DENIAL. The provider subscribes to the query and mutation caches of the client
 * above it and, for every request that ends in error, asks `upgradeFeatureForDenial`, which keys
 * on `code: "entitlement_required"` + `details.feature` through the canonical reader (never on
 * the status). One subscription, so no page has to know the code. A query or mutation carrying
 * `meta: ENTITLEMENT_DENIAL_INLINE_META` is skipped: the calendar renders its own upsell (ruling
 * 3). The exam report's lapsed state is an HTTP 200 payload, so it never reaches this listener;
 * the report page opens the modal itself.
 *
 * trade-offs: `autoOpenOnDenial` is a display switch, not a gate. The app root turns it on for a
 * student only, because a guardian's per-student reads answer the same denial body and this is
 * a student's modal. The server decides every request regardless. A denied query that refetches
 * on remount opens the modal again; that is the "any entitlement_required response" rule.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Lock } from "lucide-react";
import type {
  FeatureLockReason,
  LockableFeatureKey,
} from "@lyceon/shared/feature-access";
import { Modal, ModalClose } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import {
  UPGRADE_MODAL_COPY,
  UPGRADE_MODAL_SHARED_COPY,
  UPGRADE_PLANS_DESTINATION,
  upgradeFeatureForDenial,
} from "./upgrade-modal";

type UpgradeModalRequest = {
  readonly feature: LockableFeatureKey;
  readonly reason: FeatureLockReason;
};

type UpgradeModalApi = {
  /** Opens the modal for `feature`. `reason` defaults to `plan`; `age` shows the age message. */
  readonly open: (
    feature: LockableFeatureKey,
    reason?: FeatureLockReason,
  ) => void;
  readonly close: () => void;
  /** What is showing, or null when closed. */
  readonly current: UpgradeModalRequest | null;
};

const UpgradeModalContext = createContext<UpgradeModalApi | null>(null);

export function useUpgradeModal(): UpgradeModalApi {
  const api = useContext(UpgradeModalContext);
  if (api === null) {
    // A wiring bug, not an expected failure: the provider is mounted once at the app root.
    throw new Error(
      "useUpgradeModal must be used inside <UpgradeModalProvider>",
    );
  }
  return api;
}

type UpgradeModalProviderProps = {
  readonly children: ReactNode;
  /** Open on an `entitlement_required` response from any query or mutation. Default true. */
  readonly autoOpenOnDenial?: boolean;
};

export function UpgradeModalProvider({
  children,
  autoOpenOnDenial = true,
}: UpgradeModalProviderProps): JSX.Element {
  const [current, setCurrent] = useState<UpgradeModalRequest | null>(null);
  const queryClient = useQueryClient();

  /**
   * FOCUS RETURN. Radix returns focus to its own Trigger, and this modal has none: it is opened
   * from the rail, a card or a refused request. So the element focused when it opened is held
   * here and focused again once it closes (register §2 Keyboard; DESIGN.md §1 focus).
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const show = useCallback((next: UpgradeModalRequest): void => {
    // Captured only on the first open: a second open while showing keeps the original opener.
    if (returnFocusTo.current === null) {
      const active = document.activeElement;
      returnFocusTo.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    }
    setCurrent(next);
  }, []);

  const open = useCallback(
    (feature: LockableFeatureKey, reason: FeatureLockReason = "plan"): void => {
      show({ feature, reason });
    },
    [show],
  );
  const close = useCallback((): void => setCurrent(null), []);

  // Runs after the dialog has unmounted (its own close-focus has already fired), so this wins.
  useEffect(() => {
    if (current !== null) return;
    const target = returnFocusTo.current;
    returnFocusTo.current = null;
    if (target !== null && target.isConnected) target.focus();
  }, [current]);

  // Subscribing to an external store (the query client's caches): an effect is the right tool.
  useEffect(() => {
    if (!autoOpenOnDenial) return undefined;
    const openFor = (
      error: unknown,
      meta: Readonly<Record<string, unknown>> | undefined,
    ): void => {
      const feature = upgradeFeatureForDenial(error, meta);
      if (feature !== null) show({ feature, reason: "plan" });
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        openFor(event.action.error, event.query.meta);
      }
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        openFor(event.action.error, event.mutation.meta);
      }
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient, autoOpenOnDenial, show]);

  const api = useMemo<UpgradeModalApi>(
    () => ({ open, close, current }),
    [open, close, current],
  );

  return (
    <UpgradeModalContext.Provider value={api}>
      {children}
      <UpgradeModalView request={current} onClose={close} />
    </UpgradeModalContext.Provider>
  );
}

function UpgradeModalView({
  request,
  onClose,
}: {
  request: UpgradeModalRequest | null;
  onClose: () => void;
}): JSX.Element {
  const [, navigate] = useLocation();
  const copy =
    request === null
      ? null
      : UPGRADE_MODAL_COPY[request.feature][request.reason];
  const isPlan = request?.reason === "plan";

  return (
    <Modal
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      data-testid="upgrade-modal"
      title={
        <>
          <Lock
            aria-hidden="true"
            className="mb-3 block h-[26px] w-[26px] text-lyc-ink-strong"
          />
          {copy?.title ?? ""}
        </>
      }
      description={copy?.body}
      footer={
        <>
          {isPlan ? (
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              data-testid="upgrade-modal-see-plans"
              onClick={() => {
                onClose();
                navigate(UPGRADE_PLANS_DESTINATION);
              }}
            >
              {UPGRADE_MODAL_SHARED_COPY.primaryLabel}
            </Button>
          ) : null}
          <ModalClose asChild>
            <Button type="button" variant="lyc-quiet" size="lyc-lg">
              {UPGRADE_MODAL_SHARED_COPY.secondaryLabel}
            </Button>
          </ModalClose>
        </>
      }
    >
      {isPlan ? (
        <p className="m-0 text-lyc-meta-lg text-lyc-muted">
          {UPGRADE_MODAL_SHARED_COPY.includedLine}
        </p>
      ) : null}
    </Modal>
  );
}
