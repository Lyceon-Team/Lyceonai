import {
  AppNotice,
  type AppNoticeProps,
} from "@/components/feedback/AppNotice";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1; audit §6.2 "Alert / notice"] |
 *       @implemented [2026-10-03]
 *
 * plain English: the student notice is the shared AppNotice in one of its `lyc-*` variants; this
 * wrapper only names the tone in plain words, so a student page writes
 * `<Notice tone="danger" title=… />` and cannot reach for a non-student variant by accident.
 * Danger is announced with role="alert"; every other tone is a polite role="status".
 */
type NoticeTone = "neutral" | "info" | "warning" | "danger" | "success";

type NoticeProps = Omit<AppNoticeProps, "variant"> & {
  tone?: NoticeTone;
};

export function Notice({ tone = "neutral", ...props }: NoticeProps) {
  return <AppNotice variant={`lyc-${tone}`} {...props} />;
}
