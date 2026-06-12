// backend/src/lib/mergeEngine.test.ts
import { describe, it, expect } from "bun:test";
import { merge, applyResolutions, type EditorState, type Conflict } from "./mergeEngine";

function base(): EditorState {
  return {
    menus: [
      { id: "m_a", name: "alpha", rows: 3 },
      { id: "m_b", name: "beta",  rows: 6 },
    ],
    commands: [],
    dialogs: [],
    templates: [],
    dataSources: [],
    i18nKeys: { greeting: { en: "hello" } },
    canvasLayout: { "m_a": { x: 0, y: 0 } },
    defaultLang: "en",
    name: "Pack",
  };
}

describe("merge — empty diff", () => {
  it("returns mergedState equal to dst, no conflicts", () => {
    const b = base();
    const result = merge(b, structuredClone(b), structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState).toEqual(b);
  });
});

describe("merge — add on src only", () => {
  it("merged contains src's new item", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    const dst = structuredClone(b);
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
    expect(result.mergedState.menus!).toHaveLength(3);
  });
});

describe("merge — add on dst only", () => {
  it("merged contains dst's new item", () => {
    const b = base();
    const dst = structuredClone(b);
    dst.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    const result = merge(b, structuredClone(b), dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
  });
});

describe("merge — add same id different content (modify-modify on a new item)", () => {
  it("returns a conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus!.push({ id: "m_c", name: "src_gamma", rows: 1 } as never);
    const dst = structuredClone(b);
    dst.menus!.push({ id: "m_c", name: "dst_gamma", rows: 2 } as never);
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("menus:m_c");
    expect(result.conflicts[0].resolution).toBe("modify-modify");
  });
});

describe("merge — modify on src only", () => {
  it("merged has src's version, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-renamed";
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-renamed");
  });
});

describe("merge — modify both same value", () => {
  it("no conflict (deepEqual src == dst)", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-renamed";
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-renamed";
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-renamed");
  });
});

describe("merge — modify both different", () => {
  it("returns a modify-modify conflict; mergedState defaults to dst", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-src";
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-dst";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("menus:m_a");
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-dst");
  });
});

describe("merge — delete on src, untouched on dst", () => {
  it("merged has the item removed, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });
});

describe("merge — delete on src, modified on dst", () => {
  it("returns delete-modify conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-renamed";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe("delete-modify");
    expect(result.conflicts[0].srcValue).toBeNull();
    expect(result.conflicts[0].dstValue).not.toBeNull();
  });
});

describe("merge — delete on both", () => {
  it("merged has the item removed, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    const dst = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    dst.menus = dst.menus!.filter((m) => m.id !== "m_a");
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });
});

describe("merge — i18nKeys map", () => {
  it("auto-merges different keys", () => {
    const b = base();
    const src = structuredClone(b);
    src.i18nKeys!["new_key"] = { en: "hi" };
    const dst = structuredClone(b);
    dst.i18nKeys!["other_key"] = { en: "yo" };
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.i18nKeys!["new_key"]).toBeDefined();
    expect(result.mergedState.i18nKeys!["other_key"]).toBeDefined();
  });

  it("returns conflict when both modify the same key", () => {
    const b = base();
    const src = structuredClone(b);
    src.i18nKeys!["greeting"] = { en: "hi" };
    const dst = structuredClone(b);
    dst.i18nKeys!["greeting"] = { en: "yo" };
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("i18nKeys:greeting");
  });
});

describe("merge — canvasLayout map", () => {
  it("returns conflict when both move the same entity", () => {
    const b = base();
    const src = structuredClone(b);
    src.canvasLayout!["m_a"] = { x: 100, y: 0 };
    const dst = structuredClone(b);
    dst.canvasLayout!["m_a"] = { x: 200, y: 0 };
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("canvasLayout:m_a");
  });
});

describe("merge — canvasEdges map", () => {
  it("auto-merges a new edge added on src only", () => {
    const b = base();
    const src = structuredClone(b);
    src.canvasEdges = { "a->b": { from: { side: "top", t: 0.3 } } };
    const dst = structuredClone(b);
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect((result.mergedState.canvasEdges as Record<string, unknown>)?.["a->b"]).toEqual({ from: { side: "top", t: 0.3 } });
  });

  it("returns conflict when both modify the same edge", () => {
    const b = base();
    b.canvasEdges = { "a->b": { from: { side: "top", t: 0.3 } } };
    const src = structuredClone(b);
    (src.canvasEdges as Record<string, unknown>)["a->b"] = { from: { side: "top", t: 0.5 } };
    const dst = structuredClone(b);
    (dst.canvasEdges as Record<string, unknown>)["a->b"] = { from: { side: "bottom", t: 0.1 } };
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("canvasEdges:a->b");
  });
});

describe("merge — scalar defaultLang", () => {
  it("auto-merges when only one side changes", () => {
    const b = base();
    const src = structuredClone(b);
    src.defaultLang = "fr";
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.defaultLang).toBe("fr");
  });

  it("conflicts when both change to different value", () => {
    const b = base();
    const src = structuredClone(b);
    src.defaultLang = "fr";
    const dst = structuredClone(b);
    dst.defaultLang = "de";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("scalar:defaultLang");
  });
});

describe("merge — mixed multiple collections", () => {
  it("collects all conflicts and auto-merges the rest", () => {
    const b = base();
    const src = structuredClone(b);
    const dst = structuredClone(b);
    // Conflict: m_a modified differently
    src.menus![0].name = "src-a";
    dst.menus![0].name = "dst-a";
    // Auto: src adds m_c
    src.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    // Conflict: defaultLang
    src.defaultLang = "fr";
    dst.defaultLang = "es";
    // Auto: dst adds i18n key
    dst.i18nKeys!["new_one"] = { en: "x" };

    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(2);  // m_a + defaultLang
    expect(result.conflicts.map((c) => c.conflictKey).sort()).toEqual([
      "menus:m_a", "scalar:defaultLang",
    ]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
    expect(result.mergedState.i18nKeys!["new_one"]).toBeDefined();
  });
});

describe("applyResolutions", () => {
  it("applies 'src' choice for a modify-modify conflict on a menu", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src-a", rows: 4 },
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: { id: "m_a", name: "base-a", rows: 3 },
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "src" });
    expect(final.menus!.find((m) => m.id === "m_a")!.name).toBe("src-a");
  });

  it("applies 'dst' choice = no-op (merged already has dst)", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src-a", rows: 4 },
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: null,
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "dst" });
    expect(final.menus!.find((m) => m.id === "m_a")!.name).toBe("dst-a");
  });

  it("delete-modify with 'src' choice removes the item", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "delete-modify",
      srcValue: null,                                 // src deleted
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: { id: "m_a", name: "base-a", rows: 3 },
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "src" });
    expect(final.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });

  it("applies 'src' for an i18nKeys conflict", () => {
    const merged: EditorState = {
      i18nKeys: { greeting: { en: "dst-hello" } },
    };
    const conflicts: Conflict[] = [{
      conflictKey: "i18nKeys:greeting",
      collection: "i18nKeys",
      resolution: "modify-modify",
      srcValue: { en: "src-hi" },
      dstValue: { en: "dst-hello" },
      baseValue: { en: "hello" },
    }];
    const final = applyResolutions(merged, conflicts, { "i18nKeys:greeting": "src" });
    expect(final.i18nKeys!.greeting).toEqual({ en: "src-hi" });
  });

  it("applies 'src' for a scalar conflict", () => {
    const merged: EditorState = { defaultLang: "es" };
    const conflicts: Conflict[] = [{
      conflictKey: "scalar:defaultLang",
      collection: "scalar",
      resolution: "modify-modify",
      srcValue: "fr",
      dstValue: "es",
      baseValue: "en",
    }];
    const final = applyResolutions(merged, conflicts, { "scalar:defaultLang": "src" });
    expect(final.defaultLang).toBe("fr");
  });

  it("throws when a resolution is missing for a known conflict", () => {
    const merged: EditorState = { menus: [{ id: "m_a", name: "x" }] };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a", collection: "menus", resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src" }, dstValue: { id: "m_a", name: "dst" }, baseValue: null,
    }];
    expect(() => applyResolutions(merged, conflicts, {})).toThrow(/missing/i);
  });

  it("throws when a resolution value is not 'src' or 'dst'", () => {
    const merged: EditorState = { menus: [{ id: "m_a", name: "x" }] };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a", collection: "menus", resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src" }, dstValue: { id: "m_a", name: "dst" }, baseValue: null,
    }];
    expect(() => applyResolutions(merged, conflicts, { "menus:m_a": "bogus" as never })).toThrow(/invalid/i);
  });
});
