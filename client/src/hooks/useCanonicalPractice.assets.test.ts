import { describe, expect, it } from "vitest";
import type {
  PracticeQuestion,
  PracticeAssetItem,
} from "./useCanonicalPractice";

describe("normalizeQuestion — assets threading", () => {
  it("PracticeQuestion type includes assets field", () => {
    const q: PracticeQuestion = {
      stem: "What is 2+2?",
      assets: {
        v: 1,
        items: [
          {
            id: "a1",
            kind: "svg",
            role: "stimulus",
            alt: "A triangle",
            svg: "<svg></svg>",
          },
        ],
      },
    };
    expect(q.assets).toBeDefined();
    expect(q.assets?.v).toBe(1);
    expect(q.assets?.items).toHaveLength(1);
    expect(q.assets?.items[0].kind).toBe("svg");
  });

  it("PracticeQuestion accepts table assets", () => {
    const q: PracticeQuestion = {
      stem: "Read the table",
      assets: {
        v: 1,
        items: [
          {
            id: "t1",
            kind: "table",
            role: "stimulus",
            alt: "Data table",
            headers: ["x", "y"],
            rows: [
              ["1", "2"],
              ["3", "4"],
            ],
          },
        ],
      },
    };
    expect(q.assets?.items[0].kind).toBe("table");
    if (q.assets?.items[0].kind === "table") {
      expect(q.assets.items[0].headers).toEqual(["x", "y"]);
      expect(q.assets.items[0].rows).toHaveLength(2);
    }
  });

  it("PracticeQuestion accepts null/undefined assets", () => {
    const q1: PracticeQuestion = { stem: "No assets" };
    const q2: PracticeQuestion = { stem: "Null assets", assets: null };
    expect(q1.assets).toBeUndefined();
    expect(q2.assets).toBeNull();
  });

  it("discriminated union narrows correctly on kind", () => {
    const item: PracticeAssetItem = {
      id: "x",
      kind: "svg",
      role: "stimulus",
      alt: "test",
      svg: "<svg/>",
    };
    if (item.kind === "svg") {
      expect(item.svg).toBe("<svg/>");
    }

    const tableItem: PracticeAssetItem = {
      id: "y",
      kind: "table",
      role: "option",
      alt: "test table",
      headers: ["a"],
      rows: [["1"]],
    };
    if (tableItem.kind === "table") {
      expect(tableItem.headers).toEqual(["a"]);
    }
  });
});
