import { describe, expect, it, vi, beforeEach } from "vitest";
import { useServerDataSourcesStore } from "./serverDataSourcesStore";

describe("serverDataSourcesStore", () => {
  beforeEach(() => {
    useServerDataSourcesStore.setState({ sources: [], status: "idle" });
  });

  it("loads sources from the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data_sources: [{ ref: "boutique:items", schema_hint: "id, name" }],
    }))));
    await useServerDataSourcesStore.getState().load("tok");
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "boutique:items", schemaHint: "id, name" },
    ]);
    expect(useServerDataSourcesStore.getState().status).toBe("ready");
  });

  it("stays idle-safe on failure (empty list, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await useServerDataSourcesStore.getState().load("tok");
    expect(useServerDataSourcesStore.getState().sources).toEqual([]);
  });
});
