import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserPack, saveUserPack } from "./userPacks";

describe("userPacks API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadUserPack GET /api/user/packs/:packId returns content", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          pack: { id: "p1", hash: "h1" },
          files: { "a.yaml": "x" },
          editor: { id: "p1", menus: [] },
        }),
        { status: 200 }
      )
    );
    const res = await loadUserPack("p1");
    expect(res.pack.id).toBe("p1");
    expect(res.files["a.yaml"]).toBe("x");
  });

  it("saveUserPack PUT /api/user/packs/:packId sends body", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await saveUserPack("p1", {
      hash: "h2",
      files: { a: "y" },
      editor: { id: "p1", menus: [] },
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/user/packs/p1");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string).hash).toBe("h2");
  });
});
