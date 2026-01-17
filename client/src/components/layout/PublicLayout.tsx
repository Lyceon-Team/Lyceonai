import * as React from "react";
import { PageShell } from "./primitives";
import PublicNavBar from "./PublicNavBar";
import Footer from "./Footer";

interface PublicLayoutProps {
  children: React.ReactNode;
}

export default function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <PageShell>
      <PublicNavBar />
      <main>
        {children}
      </main>
      <Footer />
    </PageShell>
  );
}
