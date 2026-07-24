import { describe, expect, it } from "vitest";
import { normalizeAssetItem, normalizeAssets } from "./useCanonicalPractice";
import type {
  PracticeQuestion,
  PracticeAssetItem,
  PreSubmitAssetRole,
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

describe("PreSubmitAssetRole — anti-leak type constraint", () => {
  it("permits stimulus and option roles only", () => {
    const roles: PreSubmitAssetRole[] = ["stimulus", "option"];
    expect(roles).toHaveLength(2);
    expect(roles).toContain("stimulus");
    expect(roles).toContain("option");
  });

  it("PracticeAssetItem role is constrained to PreSubmitAssetRole", () => {
    const svgItem: PracticeAssetItem = {
      id: "s1",
      kind: "svg",
      role: "stimulus",
      alt: "test",
      svg: "<svg/>",
    };
    const tableItem: PracticeAssetItem = {
      id: "t1",
      kind: "table",
      role: "option",
      alt: "test",
      headers: ["a"],
      rows: [["1"]],
    };
    expect(svgItem.role).toBe("stimulus");
    expect(tableItem.role).toBe("option");
  });
});

describe("normalizeAssetItem — per-item validation", () => {
  it("accepts valid svg stimulus item", () => {
    const item = {
      id: "a1",
      kind: "svg",
      role: "stimulus",
      alt: "triangle",
      svg: "<svg/>",
    };
    expect(normalizeAssetItem(item)).toEqual(item);
  });

  it("accepts valid table option item", () => {
    const item = {
      id: "t1",
      kind: "table",
      role: "option",
      alt: "data",
      headers: ["x"],
      rows: [["1"]],
    };
    expect(normalizeAssetItem(item)).toEqual(item);
  });

  it("drops item with explanation role (anti-leak)", () => {
    const item = {
      id: "e1",
      kind: "svg",
      role: "explanation",
      alt: "explained",
      svg: "<svg/>",
    };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with unknown role", () => {
    const item = {
      id: "u1",
      kind: "svg",
      role: "answer_key",
      alt: "bad",
      svg: "<svg/>",
    };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with missing role", () => {
    const item = { id: "m1", kind: "svg", alt: "no role", svg: "<svg/>" };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with unknown kind", () => {
    const item = {
      id: "k1",
      kind: "audio",
      role: "stimulus",
      alt: "bad kind",
    };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with missing kind", () => {
    const item = { id: "k2", role: "stimulus", alt: "no kind", svg: "<svg/>" };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with missing id", () => {
    const item = { kind: "svg", role: "stimulus", alt: "no id", svg: "<svg/>" };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it("drops item with empty id", () => {
    const item = {
      id: "",
      kind: "svg",
      role: "stimulus",
      alt: "empty id",
      svg: "<svg/>",
    };
    expect(normalizeAssetItem(item)).toBeNull();
  });

  it.each([null, undefined, 42, "string", true])(
    "drops non-object value %s",
    (val) => {
      expect(normalizeAssetItem(val)).toBeNull();
    },
  );
});

describe("normalizeAssets — envelope + per-item filtering", () => {
  it("returns valid assets with only stimulus/option items", () => {
    const raw = {
      v: 1,
      items: [
        {
          id: "a1",
          kind: "svg",
          role: "stimulus",
          alt: "ok",
          svg: "<svg/>",
        },
        {
          id: "a2",
          kind: "table",
          role: "option",
          alt: "ok",
          headers: ["x"],
          rows: [["1"]],
        },
      ],
    };
    const result = normalizeAssets(raw);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
  });

  it("drops explanation-role items, keeps valid ones", () => {
    const raw = {
      v: 1,
      items: [
        {
          id: "s1",
          kind: "svg",
          role: "stimulus",
          alt: "keep",
          svg: "<svg/>",
        },
        {
          id: "e1",
          kind: "svg",
          role: "explanation",
          alt: "drop",
          svg: "<svg/>",
        },
      ],
    };
    const result = normalizeAssets(raw);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].id).toBe("s1");
  });

  it("returns null when all items are explanation-role", () => {
    const raw = {
      v: 1,
      items: [
        {
          id: "e1",
          kind: "svg",
          role: "explanation",
          alt: "drop",
          svg: "<svg/>",
        },
      ],
    };
    expect(normalizeAssets(raw)).toBeNull();
  });

  it("drops unknown-kind items, keeps valid ones", () => {
    const raw = {
      v: 1,
      items: [
        {
          id: "s1",
          kind: "svg",
          role: "stimulus",
          alt: "keep",
          svg: "<svg/>",
        },
        { id: "b1", kind: "audio", role: "stimulus", alt: "drop" },
      ],
    };
    const result = normalizeAssets(raw);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].id).toBe("s1");
  });

  it("returns null for wrong version", () => {
    const raw = {
      v: 2,
      items: [
        {
          id: "a1",
          kind: "svg",
          role: "stimulus",
          alt: "ok",
          svg: "<svg/>",
        },
      ],
    };
    expect(normalizeAssets(raw)).toBeNull();
  });

  it("returns null for missing items array", () => {
    expect(normalizeAssets({ v: 1 })).toBeNull();
  });

  it("returns null for empty items array", () => {
    expect(normalizeAssets({ v: 1, items: [] })).toBeNull();
  });

  it.each([null, undefined, 42, "string"])(
    "returns null for non-object %s",
    (val) => {
      expect(normalizeAssets(val)).toBeNull();
    },
  );
});
