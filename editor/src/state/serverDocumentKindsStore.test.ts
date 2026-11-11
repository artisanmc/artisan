import { beforeEach, describe, expect, it, vi } from "vitest";
import { isKindSyncedOn, useServerDocumentKindsStore } from "./serverDocumentKindsStore";

describe("serverDocumentKindsStore", () => {
  beforeEach(() => {
    useServerDocumentKindsStore.setState({ kinds: [], status: "idle", loadedKey: null });
  });

  it("loads the kinds the active server registered", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            document_kinds: [
              { kind: "menu", dir: "menus", schema_versions: ["menu/v1", "menu/v2"] },
              {
                kind: "quest",
                dir: "quests",
                schema_versions: ["quest/v1"],
                id_prefix: "q_",
                module_id: "quests",
              },
              { dir: "broken" },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await useServerDocumentKindsStore.getState().load({ serverId: "srv1" });
    expect(useServerDocumentKindsStore.getState().kinds).toEqual([
      {
        kind: "menu",
        dir: "menus",
        schemaVersions: ["menu/v1", "menu/v2"],
        idPrefix: null,
        moduleId: null,
      },
      {
        kind: "quest",
        dir: "quests",
        schemaVersions: ["quest/v1"],
        idPrefix: "q_",
        moduleId: "quests",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/servers/srv1/document-kinds"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("stays usable on failure (empty list, status ready)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await useServerDocumentKindsStore.getState().load({ serverId: "srv1" });
    expect(useServerDocumentKindsStore.getState().kinds).toEqual([]);
    expect(useServerDocumentKindsStore.getState().status).toBe("ready");
  });

  it("flags a kind only when the server answered and left it out", () => {
    const quest = {
      kind: "quest",
      dir: "quests",
      schemaVersions: ["quest/v1"],
      idPrefix: null,
      moduleId: "quests",
    };
    expect(
      isKindSyncedOn({ kinds: [], status: "idle", loadedKey: null, load: async () => {} }, "quest"),
    ).toBe(true);
    expect(
      isKindSyncedOn(
        { kinds: [], status: "ready", loadedKey: "u:s", load: async () => {} },
        "quest",
      ),
    ).toBe(true);
    expect(
      isKindSyncedOn(
        { kinds: [quest], status: "ready", loadedKey: "u:s", load: async () => {} },
        "quest",
      ),
    ).toBe(true);
    expect(
      isKindSyncedOn(
        { kinds: [quest], status: "ready", loadedKey: "u:s", load: async () => {} },
        "shop",
      ),
    ).toBe(false);
  });
});
