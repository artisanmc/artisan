import { afterEach, describe, expect, it, vi } from "vitest";
import { publishBundle } from "./bundlePublisher";

describe("publishBundle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs files to /api/v1/bundles/:packId with Bearer auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "abc123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const files = { "plugins/Artisan/packs/p_test/manifest.yaml": "schema: manifest/v1\n" };
    const result = await publishBundle({
      apiUrl: "http://localhost:3001",
      serverKey: "sk_abc",
      packId: "p_test",
      files,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/bundles/p_test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer sk_abc",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ files }),
      }),
    );
    expect(result).toEqual({ hash: "abc123" });
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(publishBundle({ apiUrl: "http://x", serverKey: "k", packId: "p", files: {} }))
      .rejects.toThrow("401");
  });
});
