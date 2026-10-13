import { describe, test, expect, vi, beforeEach } from "vitest";
import { resolveModel, faceVerts, defaultUV, faceUVs, clearCaches } from "./mcModelRenderer";

// resolveModel only uses fetch — no WebGL needed. We mock fetch globally.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  clearCaches();
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
});

describe("faceVerts", () => {
  test("up face returns 4 vertices at y=to.y", () => {
    const verts = faceVerts("up", 0, 0, 0, 16, 16, 16);
    // All y coordinates should be 16 (to.y)
    expect(verts[1]).toBe(16);  // v0.y
    expect(verts[4]).toBe(16);  // v1.y
    expect(verts[7]).toBe(16);  // v2.y
    expect(verts[10]).toBe(16); // v3.y
  });

  test("north face returns 4 vertices at z=from.z", () => {
    const verts = faceVerts("north", 0, 0, 0, 16, 16, 16);
    // All z coordinates should be 0 (from.z)
    expect(verts[2]).toBe(0);  // v0.z
    expect(verts[5]).toBe(0);  // v1.z
    expect(verts[8]).toBe(0);  // v2.z
    expect(verts[11]).toBe(0); // v3.z
  });
});

describe("faceUVs", () => {
  test("0° rotation maps TL corner to (u1/16, 1-v1/16)", () => {
    const uvs = faceUVs(0, 0, 16, 16, 0);
    // First triangle vertex 0 (TL) should be u1/16=0, 1-v1/16=1
    expect(uvs[0]).toBeCloseTo(0);   // u
    expect(uvs[1]).toBeCloseTo(1);   // v (flipped)
  });

  test("90° rotation shifts UV corners by 1 step", () => {
    const uvs = faceUVs(0, 0, 16, 16, 90);
    // With 90° CW rotation, corner[0] (TL of face) samples BL of texture
    // BL = corners[3] = (u1/16, 1-v2/16) = (0, 0)
    expect(uvs[0]).toBeCloseTo(0); // u
    expect(uvs[1]).toBeCloseTo(0); // v
  });
});

describe("defaultUV", () => {
  test("south face default UV uses from.x, to.x, and y-flipped y coords", () => {
    const uv = defaultUV("south", [2, 3, 4], [14, 13, 12]);
    expect(uv).toEqual([2, 16-13, 14, 16-3]); // [from.x, 16-to.y, to.x, 16-from.y]
  });
});
