/**
 * @spec [Doc_05F_Study_Calendar, §17.6 "why this block" copy (student only)]
 *       [Doc_05F_formula_sheet.md §8 item 16 — copy table re-keyed to what the generators emit]
 *
 * plain English: the load-bearing rule of this module is that NO KEY EVER RENDERS AS RAW
 * TEXT. The two coverage tests below walk the shared enums the generators emit against, so
 * adding a key to `BLOCK_EXPLANATION_KEYS` or `DOMAIN_EXPLANATION_KEYS` without writing copy
 * for it fails here rather than shipping "weighted" to a student's screen.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCK_EXPLANATION_KEYS,
  DOMAIN_EXPLANATION_KEYS,
} from "@lyceon/shared";
import {
  EXPLANATION_COPY_TABLES,
  blockExplanation,
  domainExplanation,
  explanationLines,
} from "./explanations";

/**
 * `weighted` is the ONE block key ruled to have no block-level copy (owner ruling
 * 2026-09-22, addendum item 16). It is the key on a practice block that HAS a domain mix,
 * and `explanationLines` prefers that mix's per-domain reasons — which are more specific
 * and already on screen. A generic sentence above them would say less and take more room.
 *
 * Named here as a constant rather than special-cased inline, so the exemption is ONE entry
 * long and visible. A second key added to it is a decision someone has to make on purpose.
 */
const BLOCK_KEYS_WITH_NO_COPY_BY_RULING = ["weighted"] as const;

const BLOCK_KEYS_REQUIRING_COPY = BLOCK_EXPLANATION_KEYS.filter(
  (key) =>
    !(BLOCK_KEYS_WITH_NO_COPY_BY_RULING as readonly string[]).includes(key),
);

describe("every canonical key has copy (§17.6: no key renders as raw text)", () => {
  it.each([...BLOCK_KEYS_REQUIRING_COPY])(
    "has non-empty block copy for the generator key %s",
    (key) => {
      const copy = blockExplanation(key);
      expect(copy).not.toBeNull();
      expect(typeof copy).toBe("string");
      expect((copy ?? "").trim().length).toBeGreaterThan(0);
      // The copy is a sentence, never the key echoed back.
      expect(copy).not.toBe(key);
    },
  );

  it.each([...DOMAIN_EXPLANATION_KEYS])(
    "has non-empty domain copy for the generator key %s",
    (key) => {
      const copy = domainExplanation(key);
      expect(copy).not.toBeNull();
      expect(typeof copy).toBe("string");
      expect((copy ?? "").trim().length).toBeGreaterThan(0);
      expect(copy).not.toBe(key);
    },
  );

  it("covers the block enum with no gaps beyond the one ruled exemption", () => {
    const missing = BLOCK_EXPLANATION_KEYS.filter(
      (key) => blockExplanation(key) === null,
    );
    // EXACTLY the exemption — not "at most". A key that quietly loses its copy shows up
    // here as an extra entry, and a key added to the enum without copy does too.
    expect(missing).toEqual([...BLOCK_KEYS_WITH_NO_COPY_BY_RULING]);
  });

  it("still explains a `weighted` block, through its per-domain reasons", () => {
    // This is what makes the exemption safe rather than a hole: the block is not left
    // unexplained, the explanation just comes from the more specific place.
    expect(blockExplanation("weighted")).toBeNull();
    expect(
      explanationLines({ blockKey: "weighted", domainKeys: ["weak"] }),
    ).toEqual(["One of your weaker areas right now."]);
  });

  it("covers the domain enum with no gaps — a new key without copy fails here", () => {
    const missing = DOMAIN_EXPLANATION_KEYS.filter(
      (key) => domainExplanation(key) === null,
    );
    expect(missing).toEqual([]);
  });

  it("carries no copy for a key the generators cannot emit", () => {
    // The retired `weak_domain`/`maintain_strength`/`post_exam_focus` vocabulary from the
    // pre-sheet §17.6 must not linger in the tables: it would be unreachable dead copy.
    expect(Object.keys(EXPLANATION_COPY_TABLES.block).sort()).toEqual(
      [...BLOCK_KEYS_REQUIRING_COPY].sort(),
    );
    expect(Object.keys(EXPLANATION_COPY_TABLES.domain).sort()).toEqual(
      [...DOMAIN_EXPLANATION_KEYS].sort(),
    );
  });
});

describe("blockExplanation", () => {
  it("returns the §17.6 sentence for a known key", () => {
    expect(blockExplanation("review_due")).toBe(
      "Questions you missed earlier are due for a retry.",
    );
    expect(blockExplanation("cold_start")).toBe(
      "We're still learning where you stand — this balances the sections.",
    );
  });

  it("returns null for an unknown key — never the key, never an empty string", () => {
    const unknown = blockExplanation("a_key_a_student_edit_invented");
    expect(unknown).toBeNull();
    expect(unknown).not.toBe("");
    expect(unknown).not.toBe("a_key_a_student_edit_invented");
  });

  it("returns null for a retired pre-sheet key", () => {
    expect(blockExplanation("weak_domain")).toBeNull();
    expect(blockExplanation("maintain_strength")).toBeNull();
    expect(blockExplanation("post_exam_focus")).toBeNull();
    expect(blockExplanation("spacing_revisit")).toBeNull();
  });

  it("returns null for a null key — a student's own block is not explained back to them", () => {
    expect(blockExplanation(null)).toBeNull();
  });
});

describe("domainExplanation", () => {
  it("returns the per-domain sentence for a known key", () => {
    expect(domainExplanation("weak")).toBe(
      "One of your weaker areas right now.",
    );
    expect(domainExplanation("post_exam")).toBe("Your last test pointed here.");
  });

  it("returns null for an unknown key and for null", () => {
    expect(domainExplanation("not_a_domain_key")).toBeNull();
    expect(domainExplanation("")).toBeNull();
    expect(domainExplanation(null)).toBeNull();
  });

  it("does not answer a BLOCK key — the two vocabularies are separate", () => {
    expect(domainExplanation("review_due")).toBeNull();
    expect(blockExplanation("weak")).toBeNull();
  });
});

describe("explanationLines (§17.6 'Why this is here')", () => {
  it("prefers the DOMAIN copy when the block has a mix — it is specific where the block key is generic", () => {
    expect([
      ...explanationLines({
        blockKey: "weighted",
        domainKeys: ["weak", "strength"],
      }),
    ]).toEqual([
      "One of your weaker areas right now.",
      "You're strong here — a short set keeps it sharp.",
    ]);
  });

  it("de-duplicates: three `weak` domains is ONE reason, not three", () => {
    const lines = explanationLines({
      blockKey: "weighted",
      domainKeys: ["weak", "weak", "weak"],
    });
    expect([...lines]).toEqual(["One of your weaker areas right now."]);
  });

  it("keeps the mix's order for the reasons it does show", () => {
    expect([
      ...explanationLines({
        blockKey: "weighted",
        domainKeys: ["balanced", "weak", "balanced", "exploring"],
      }),
    ]).toEqual([
      "Keeping this one moving.",
      "One of your weaker areas right now.",
      "We haven't seen enough of this yet.",
    ]);
  });

  it("falls back to the block key when there are NO domain keys (section-level scope)", () => {
    expect([...explanationLines({ blockKey: "cold_start" })]).toEqual([
      "We're still learning where you stand — this balances the sections.",
    ]);
    expect([
      ...explanationLines({ blockKey: "cold_start", domainKeys: [] }),
    ]).toEqual([
      "We're still learning where you stand — this balances the sections.",
    ]);
  });

  it("falls back to the block key when NONE of the domain keys is recognised", () => {
    expect([
      ...explanationLines({
        blockKey: "taper",
        domainKeys: ["nonsense", null, "also_nonsense"],
      }),
    ]).toEqual(["Test week: lighter days so you arrive rested."]);
  });

  it("shows only the recognised domain lines when some are unknown — no fallback alongside", () => {
    expect([
      ...explanationLines({
        blockKey: "weighted",
        domainKeys: [null, "weak", "nonsense"],
      }),
    ]).toEqual(["One of your weaker areas right now."]);
  });

  it("returns [] when nothing is recognised at all — the panel disappears, it never renders empty", () => {
    expect([...explanationLines({ blockKey: null })]).toEqual([]);
    expect([
      ...explanationLines({ blockKey: null, domainKeys: [null, null] }),
    ]).toEqual([]);
    expect([
      ...explanationLines({
        blockKey: "a_student_edit_key",
        domainKeys: ["nonsense"],
      }),
    ]).toEqual([]);
  });
});

/**
 * Regression: a stored `explanation_key` that collides with an Object.prototype member used
 * to escape the `?? null` guard and return a FUNCTION, which would have rendered as
 * `function toString() { [native code] }` in the §17.6 panel. `explanation_key` is
 * `z.string().nullable()` on the wire, so these are values the database can genuinely hold.
 */
describe("prototype-chain keys (§17.6, no key renders as raw text)", () => {
  const POLLUTED = [
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ];

  it.each(POLLUTED)(
    "returns null for the block key %s rather than a prototype member",
    (key) => {
      expect(blockExplanation(key)).toBeNull();
    },
  );

  it.each(POLLUTED)(
    "returns null for the domain key %s rather than a prototype member",
    (key) => {
      expect(domainExplanation(key)).toBeNull();
    },
  );

  it("never lets a prototype member reach explanationLines", () => {
    expect(
      explanationLines({ blockKey: "toString", domainKeys: ["valueOf"] }),
    ).toEqual([]);
  });
});
