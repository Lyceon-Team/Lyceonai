/**
 * The upgrade modal's view: what `UpgradeModalProvider` (./UpgradeModal.tsx) shows. A module of
 * its own so it loads on the first open instead of with the app entry.
 *
 * @spec [student-UI register UI-44; OQ-29; OQ-39(e); DESIGN.md §3 "Upgrade modal"; SEO plan F8]
 *       | @implemented [2026-10-07]
 */
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
} from "./upgrade-modal";

export type UpgradeModalRequest = {
  readonly feature: LockableFeatureKey;
  readonly reason: FeatureLockReason;
};

export function UpgradeModalView({
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
