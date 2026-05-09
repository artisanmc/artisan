import { describe, test, expect, vi, beforeEach } from "vitest";
import { resolveModel } from "./mcModelRenderer";

// resolveModel only uses fetch — no WebGL needed. We mock fetch globally.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("resolveModel", () => {
  test("returns null when model fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const result = await resolveModel("block/stone", "1.21.4");
    expect(result).toBeNull();
  });

  test("returns elements and textures from a flat model", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
        textures: { all: "block/stone" },
      }),
    } as Response);

    const result = await resolveModel("block/stone", "1.21.4");
    expect(result).not.toBeNull();
    expect(result!.elements).toHaveLength(1);
    expect(result!.textures.all).toBe("block/stone");
  });

  test("walks parent chain and merges textures (child overrides parent)", async () => {
    const child = { parent: "block/cube_all", textures: { all: "block/diamond_block" } };
    const parent = {
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
      textures: { all: "block/stone" },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(child) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(parent) } as Response);

    const result = await resolveModel("block/diamond_block", "1.21.4");
    expect(result).not.toBeNull();
    expect(result!.textures.all).toBe("block/diamond_block"); // child wins
    expect(result!.elements).toHaveLength(1);                 // from parent
  });

  test("uses custom models endpoint for custom items", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await resolveModel("nexo/forest_sword", "1.21.4", true, "srv_abc");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/custom/srv_abc/nexo/forest_sword"),
    );
  });
});
