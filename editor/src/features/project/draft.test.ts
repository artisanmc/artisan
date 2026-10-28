import { describe, expect, it } from "vitest";
import { draftAge, isDirty } from "./draft";

/**
 * The draft (ADR `server-disk-only-storage`, revised decisions 3 and 7): the
 * base and the current tree, kept in the browser.
 *
 * `isDirty` answers the only question that matters to the admin — "do I have
 * unsaved work?" — and must answer it **without** hashing anything: it feeds a
 * permanent indicator, not a save.
 */
describe("isDirty", () => {
  it("a tree identical to the base is not dirty", () => {
    const t = { "menus/a.yaml": "x\n", "lang/fr.yaml": "y\n" };
    expect(isDirty(t, { ...t })).toBe(false);
  });

  it("a modified content is dirty", () => {
    expect(isDirty({ "menus/a.yaml": "x\n" }, { "menus/a.yaml": "z\n" })).toBe(true);
  });

  it("an added file is dirty", () => {
    expect(isDirty({}, { "menus/a.yaml": "x\n" })).toBe(true);
  });

  it("a deleted file is dirty", () => {
    expect(isDirty({ "menus/a.yaml": "x\n" }, {})).toBe(true);
  });

  it("a missing base with an empty tree is not dirty", () => {
    // A freshly opened, empty project must not report itself as modified.
    expect(isDirty(undefined, {})).toBe(false);
  });

  it("a missing base with content is dirty", () => {
    // Nothing was ever read from the server: everything is to be written.
    expect(isDirty(undefined, { "menus/a.yaml": "x\n" })).toBe(true);
  });
});

describe("draftAge", () => {
  const now = new Date("2026-08-15T12:00:00Z").getTime();

  it("renders whole hours beyond one hour", () => {
    expect(draftAge(now - 3 * 3_600_000, now)).toEqual({ unit: "hours", value: 3 });
  });

  it("renders minutes below that — '0 h ago' means nothing", () => {
    expect(draftAge(now - 12 * 60_000, now)).toEqual({ unit: "minutes", value: 12 });
  });

  it("a draft just taken reads 'just now', not '0 minutes'", () => {
    expect(draftAge(now - 20_000, now)).toEqual({ unit: "now", value: 0 });
  });

  it("days beyond 48 h: '73 h ago' does not read well", () => {
    expect(draftAge(now - 73 * 3_600_000, now)).toEqual({ unit: "days", value: 3 });
  });
});
