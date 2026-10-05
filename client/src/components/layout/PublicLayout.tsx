import * as React from "react";
import { PageShell } from "./primitives";
import PublicNavBar from "./PublicNavBar";
import Footer, { type FooterTone } from "./Footer";

interface PublicLayoutProps {
  children: React.ReactNode;
  /**
   * F13 (owner-approved homepage design, 2026-10-05): the homepage brings its own navigation (its
   * in-page sections) and the navy footer band. Every other public page keeps the shared bar.
   */
  nav?: React.ReactNode;
  footerTone?: FooterTone;
  className?: string;
}

export default function PublicLayout({
  children,
  nav,
  footerTone = "default",
  className,
}: PublicLayoutProps) {
  return (
    <PageShell className={className}>
      {nav ?? <PublicNavBar />}
      <main>{children}</main>
      <Footer tone={footerTone} />
    </PageShell>
  );
}
