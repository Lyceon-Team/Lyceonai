/**
 * @spec [student-UI register UI-46; DESIGN.md §1, §3] | @implemented [2026-10-03]
 *
 * plain English: the student UI's shared compositions. Each one composes a canonical primitive;
 * none is a second copy of it. The primitives themselves stay where they were and gained a
 * student variant, so a student page imports them from their usual paths:
 *   Button      @/components/ui/button        variant "lyc-primary" | "lyc-outline" | "lyc-quiet"
 *                                              | "lyc-link"; size "lyc" | "lyc-lg" | "lyc-icon"
 *   Tabs        @/components/ui/tabs          <TabsList variant="lyc">, <TabsContent variant="lyc">
 *   Skeleton    @/components/ui/skeleton      variant "lyc"
 *   EmptyState  @/components/common/empty-state  variant "lyc"
 *   AppNotice   @/components/feedback/AppNotice  variants "lyc-*" (or Notice below)
 * Everything keyed to the student tokens renders inside the `.lyc` root the student shells
 * provide; FullPageLoader, Modal and Sheet carry their own, because they render outside a shell
 * (route fallbacks, auth gates) or in a portal on <body>.
 */
export { PageHeader, type PageHeaderProps } from "./PageHeader";
export { FullPageLoader, type FullPageLoaderProps } from "./FullPageLoader";
export { Modal, ModalClose, type ModalProps } from "./Modal";
export { Sheet, SheetClose, type SheetProps } from "./Sheet";
export { Notice, type NoticeProps, type NoticeTone } from "./Notice";
