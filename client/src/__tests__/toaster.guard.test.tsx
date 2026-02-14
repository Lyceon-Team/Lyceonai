import { render } from "@testing-library/react";
import { UIProvider } from "@/components/providers/ui-provider";
import { describe, it, expect } from "vitest";

describe("UIProvider toaster guard", () => {
  it("mounts exactly one toaster even if provider is rendered twice", () => {
    render(<UIProvider><div/></UIProvider>);
    render(<UIProvider><div/></UIProvider>);
    const all = document.querySelectorAll('[data-testid="toaster"]');
    expect(all.length).toBe(1);
  });
});
