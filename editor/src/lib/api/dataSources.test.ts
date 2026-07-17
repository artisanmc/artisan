import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerDataSourcesUser } from "./dataSources";

afterEach(() => vi.restoreAllMocks());

describe("fetchServerDataSourcesUser", () => {
  it("calls the user-scoped data-sources endpoint with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data_sources: [{ ref: "shop:items", schema_hint: null }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchServerDataSourcesUser("net1", "srv1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/networks/net1/servers/srv1/data-sources"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(result).toEqual([
      { ref: "shop:items", moduleId: null, schema: [], schemaHint: null, stability: null, keyField: null },
    ]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchServerDataSourcesUser("net1", "srv1")).toEqual([]);
  });

  it("returns [] on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await fetchServerDataSourcesUser("net1", "srv1")).toEqual([]);
  });
});
