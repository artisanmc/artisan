import { afterEach, describe, expect, it, vi } from "vitest";
import { listAssets, uploadAsset, uploadFontAsset, patchAsset, deleteAsset, duplicateAsset } from "./userAssets";

afterEach(() => vi.restoreAllMocks());

const A1 = {
  id: "asset_1",
  projectId: "p1",
  type: "glyph" as const,
  name: "bg",
  width: 16,
  height: 16,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
};

describe("userAssets.listAssets", () => {
  it("GETs the user-scoped assets endpoint with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [A1] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAssets("p1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(result).toEqual([A1]);
  });

  it("applies type/search filters as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await listAssets("p1", { type: "glyph", search: "coin" });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("type=glyph");
    expect(url).toContain("search=coin");
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(listAssets("p1")).rejects.toThrow();
  });
});

describe("userAssets.uploadAsset", () => {
  it("POSTs a FormData body with credentials included and returns the asset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ asset: A1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });

    const result = await uploadAsset("p1", { file, type: "glyph", name: "bg" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result).toEqual(A1);
  });

  it("throws with the backend error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Asset name already exists" }),
    }));
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadAsset("p1", { file, type: "glyph", name: "bg" })).rejects.toThrow(
      "Asset name already exists",
    );
  });
});

describe("userAssets.uploadFontAsset", () => {
  it("POSTs a font FormData body and returns { asset, warnings }", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ asset: A1, warnings: ["skipped x"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1])], "f.zip", { type: "application/zip" });

    const result = await uploadFontAsset("p1", { name: "my_font", file });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result).toEqual({ asset: A1, warnings: ["skipped x"] });
  });
});

describe("userAssets.patchAsset", () => {
  it("PATCHes with credentials included and JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ asset: A1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await patchAsset("p1", "asset_1", { ascent: 3 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets/asset_1"),
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ ascent: 3 }),
      }),
    );
    expect(result).toEqual(A1);
  });
});

describe("userAssets.deleteAsset", () => {
  it("DELETEs with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAsset("p1", "asset_1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets/asset_1"),
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(deleteAsset("p1", "asset_1")).rejects.toThrow();
  });
});

describe("userAssets.duplicateAsset", () => {
  it("POSTs to the duplicate endpoint with credentials included", async () => {
    const dup = { ...A1, id: "asset_2" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ asset: dup }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await duplicateAsset("p1", "asset_1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user/projects/p1/assets/asset_1/duplicate"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result).toEqual(dup);
  });
});
