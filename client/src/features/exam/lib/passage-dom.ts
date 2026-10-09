/**
 * Browser selection -> passage code-point offsets.
 *
 * @spec [SCL-145; E7b decision log D5] | @implemented [2026-09-25]
 *
 * plain English: every rendered segment carries its code-point `data-seg-start` /
 * `data-seg-end` and a `data-seg-kind`. A selection boundary inside a text segment
 * counts code points up to the caret; a boundary inside an atom (maths, escape) snaps
 * to the atom's start (for a range start) or end (for a range end). A selection that
 * leaves the passage returns null — nothing outside the passage can be highlighted.
 */

function segmentOf(node: Node, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  while (el !== null && el !== root) {
    if (el instanceof HTMLElement && el.dataset.segKind !== undefined) return el;
    el = el.parentNode;
  }
  return null;
}

function boundaryOffset(
  container: Node,
  offset: number,
  root: HTMLElement,
  edge: "start" | "end",
): number | null {
  if (!root.contains(container)) return null;
  if (container === root) {
    // Between root children: the child at `offset` (or the end of the last one).
    const children = Array.from(root.querySelectorAll<HTMLElement>("[data-seg-kind]"));
    if (children.length === 0) return 0;
    const child = root.childNodes[offset];
    if (child === undefined) return Number(children[children.length - 1]!.dataset.segEnd);
    const seg = child instanceof HTMLElement ? segmentOf(child, root) ?? child : null;
    const start = seg instanceof HTMLElement ? seg.dataset.segStart : undefined;
    return start === undefined ? null : Number(start);
  }
  const seg = segmentOf(container, root);
  if (seg === null) return null;
  const segStart = Number(seg.dataset.segStart);
  const segEnd = Number(seg.dataset.segEnd);
  if (seg.dataset.segKind !== "text") return edge === "start" ? segStart : segEnd;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = (container as Text).data;
    return segStart + Array.from(text.slice(0, offset)).length;
  }
  // An element boundary inside a text segment: before or after its only text node.
  return offset === 0 ? segStart : segEnd;
}

export function selectionToPassageRange(
  selection: Selection | null,
  root: HTMLElement,
): { start: number; end: number } | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const start = boundaryOffset(range.startContainer, range.startOffset, root, "start");
  const end = boundaryOffset(range.endContainer, range.endOffset, root, "end");
  if (start === null || end === null || start === end) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
