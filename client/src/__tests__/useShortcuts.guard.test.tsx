import { render } from "@testing-library/react";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";

function Harness({ onS }: { onS: () => void }) {
  useShortcuts({ s: () => onS() });
  useEffect(() => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const evt = new KeyboardEvent("keydown", { key: "s" });
    input.dispatchEvent(evt);
  }, []);
  return null;
}

describe("useShortcuts guard", () => {
  it("does NOT fire when typing in an input/textarea/contenteditable", () => {
    const spy = vi.fn();
    render(<Harness onS={spy} />);
    expect(spy).not.toHaveBeenCalled();
  });
});
