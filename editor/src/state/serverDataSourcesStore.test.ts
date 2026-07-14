import { beforeEach, describe, expect, it, vi } from "vitest";
import { useServerDataSourcesStore } from "./serverDataSourcesStore";

describe("serverDataSourcesStore", () => {
  beforeEach(() => {
    useServerDataSourcesStore.setState({ sources: [], status: "idle", loadedKey: null });
  });

  it("loads sources from the user-scoped endpoint (network+server source)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data_sources: [{ ref: "shop:items" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "shop:items", moduleId: null, schema: [], schemaHint: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/networks/net1/servers/srv1/data-sources"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("stays idle-safe on failure (empty list, no throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    expect(useServerDataSourcesStore.getState().sources).toEqual([]);
  });

  it("recovers from a network error (empty list, status ready)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    expect(useServerDataSourcesStore.getState().sources).toEqual([]);
    expect(useServerDataSourcesStore.getState().status).toBe("ready");
  });

  it("is idempotent — a second call with the same source is a no-op while not idle", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data_sources: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the source changes (server switch is not swallowed)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const ref = url.includes("srv1") ? "shop:items" : "boutique:npcs";
      return new Response(JSON.stringify({ data_sources: [{ ref }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv1" });
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "shop:items", moduleId: null, schema: [], schemaHint: null },
    ]);

    await useServerDataSourcesStore.getState().load({ networkId: "net1", serverId: "srv2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "boutique:npcs", moduleId: null, schema: [], schemaHint: null },
    ]);
  });

  it("ignores a stale resolver — A resolves after B, state reflects B", async () => {
    let resolveA: (v: Response) => void;
    const pendingA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("srv1")) return pendingA;
      return Promise.resolve(
        new Response(JSON.stringify({ data_sources: [{ ref: "boutique:npcs" }] })),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const loadA = useServerDataSourcesStore
      .getState()
      .load({ networkId: "net1", serverId: "srv1" });
    const loadB = useServerDataSourcesStore
      .getState()
      .load({ networkId: "net1", serverId: "srv2" });
    await loadB;
    expect(useServerDataSourcesStore.getState().loadedKey).toBe("u:net1/srv2");

    resolveA!(new Response(JSON.stringify({ data_sources: [{ ref: "shop:items" }] })));
    await loadA;

    expect(useServerDataSourcesStore.getState().loadedKey).toBe("u:net1/srv2");
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "boutique:npcs", moduleId: null, schema: [], schemaHint: null },
    ]);
  });
});
