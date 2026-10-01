/**
 * Is it centred? — the 390px measurement behind the owner's phone-centring decision.
 *
 * @spec [owner decision 2026-10-01 on PR 1003, item 10 ("a Playwright check at 390px that each
 *       listed element's computed text-align is center, or that it's centred in its
 *       container")] | @implemented [2026-10-01]
 *
 * plain English: shared by `guardian-surfaces.spec.ts` (the guardian pages) and
 * `student-calendar.spec.ts` (the student calendar, R11), so both measure the same way.
 * Three modes, each within 2px:
 *   - "text":  every visual line of the element's text is centred in its content box;
 *   - "box":   the element's box is centred in its parent's content box;
 *   - "lines": the element's children, grouped into visual lines, are each centred in it —
 *     used only for a row of controls; a full-width child would pass it trivially, so text
 *     is measured as text.
 * A selector that matches nothing visible is itself a failure (presence first).
 */
import type { Page } from "@playwright/test";

/**
 * `within: "parent"` measures against the parent's content box — for an element that
 * shrink-wraps its content (the calendar header's slots), which is trivially centred in itself.
 */
export type Check = {
  what: string;
  selector: string;
  mode: "text" | "box" | "lines";
  within?: "self" | "parent";
};

export async function offCentre(
  page: Page,
  checks: readonly Check[],
): Promise<string[]> {
  return page.evaluate((list) => {
    const failures: string[] = [];
    const contentBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const left =
        r.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth);
      const right =
        r.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth);
      return { left, right };
    };
    const reference = (el: Element, within: "self" | "parent") =>
      within === "parent" && el.parentElement !== null
        ? contentBox(el.parentElement)
        : contentBox(el);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== "hidden" &&
        s.display !== "none"
      );
    };
    // One visual line = boxes that overlap vertically (a 32px number and a 16px label beside
    // it sit on one line though their tops differ).
    const linesOf = (rects: DOMRect[]) => {
      const lines: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = [];
      for (const r of rects) {
        if (r.width === 0 || r.height === 0) continue;
        const line = lines.find(
          (l) => r.top < l.bottom - 1 && r.bottom > l.top + 1,
        );
        if (line) {
          line.left = Math.min(line.left, r.left);
          line.right = Math.max(line.right, r.right);
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        } else
          lines.push({
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          });
      }
      return lines;
    };
    for (const c of list) {
      const els = Array.from(document.querySelectorAll(c.selector)).filter(
        visible,
      );
      if (els.length === 0) {
        failures.push(`${c.what}: nothing visible matches ${c.selector}`);
        continue;
      }
      for (const el of els) {
        const label = `${c.what} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
        let lines: { left: number; right: number }[];
        let box: { left: number; right: number };
        if (c.mode === "box") {
          const r = el.getBoundingClientRect();
          lines = [{ left: r.left, right: r.right }];
          box = contentBox(el.parentElement!);
        } else if (c.mode === "text") {
          // Text NODES only: a range over the whole element also returns the full-width
          // boxes of block children, which would make any line look centred.
          const rects: DOMRect[] = [];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
            if ((n.textContent ?? "").trim() === "") continue;
            // Out of flow (a corner control, e.g. the student's "⋯" day menu, absolutely
            // placed) is not part of the line being centred.
            let outOfFlow = false;
            for (
              let a = n.parentElement;
              a !== null && a !== el;
              a = a.parentElement
            ) {
              const pos = getComputedStyle(a).position;
              if (pos === "absolute" || pos === "fixed") outOfFlow = true;
            }
            if (outOfFlow) continue;
            // Text inside an inline box, or a filled pill/badge (a flex item is blockified, so
            // "inline" alone misses one), counts with that box's padding: the pill is what
            // the eye centres, not the glyphs inside it.
            const host = n.parentElement;
            const hostStyle = host === null ? null : getComputedStyle(host);
            const filled =
              hostStyle !== null &&
              hostStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              host!.parentElement !== null &&
              host!.getBoundingClientRect().width <
                host!.parentElement.getBoundingClientRect().width - 4;
            const inline =
              host !== null &&
              host !== el &&
              (hostStyle!.display.startsWith("inline") || filled);
            if (inline) {
              rects.push(host.getBoundingClientRect());
              continue;
            }
            const range = document.createRange();
            range.selectNodeContents(n);
            rects.push(...Array.from(range.getClientRects()));
          }
          lines = linesOf(rects);
          box = reference(el, c.within ?? "self");
        } else {
          lines = linesOf(
            Array.from(el.children)
              .filter(visible)
              .map((k) => k.getBoundingClientRect()),
          );
          box = reference(el, c.within ?? "self");
        }
        const mid = (box.left + box.right) / 2;
        for (const line of lines) {
          const off = (line.left + line.right) / 2 - mid;
          if (Math.abs(off) > 2)
            failures.push(`${label}: ${off.toFixed(1)}px off centre`);
        }
      }
    }
    return failures;
  }, checks);
}
