import { beforeEach, describe, expect, it, vi } from "vitest";

const { registered, loadQuests } = vi.hoisted(() => {
  const questsMod = {
    id: "quests",
    displayName: "Quests",
    schemaVersion: "quests/v1",
    sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
    routes: [{ path: "/", component: () => null }],
  };
  const registered = new Map<string, unknown>();
  const loadQuests = vi.fn(async () => questsMod);
  return { registered, loadQuests };
});

vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
  registerModule: (m: { id: string }) => registered.set(m.id, m),
}));
vi.mock("@/lib/api/modules", () => ({
  fetchActiveModulesUser: vi.fn(),
}));
vi.mock("@/distribution/modules.manifest", () => ({
  MODULE_MANIFEST: [{ id: "quests", load: loadQuests }],
}));
vi.mock("@/lib/moduleDocumentKinds", () => ({
  registerEditorModule: (m: { id: string }) => registered.set(m.id, m),
}));
vi.mock("@/distribution/runtimeBundle", () => {
  class BundleError extends Error {
    constructor(readonly refusal: unknown) {
      super("refused");
    }
  }
  return { BundleError, loadRuntimeBundle: vi.fn() };
});

import { BundleError, loadRuntimeBundle } from "@/distribution/runtimeBundle";
import { fetchActiveModulesUser } from "@/lib/api/modules";
import { useModulesStore } from "./modulesStore";

beforeEach(() => {
  registered.clear();
  loadQuests.mockClear();
  vi.mocked(fetchActiveModulesUser).mockClear();
  vi.mocked(loadRuntimeBundle).mockReset();
  useModulesStore.setState({
    mountedIds: [],
    origins: {},
    refused: {},
    status: "idle",
    loadedKey: null,
  });
});

describe("useModulesStore.integrate", () => {
  it("fetches presence via the user-scoped endpoint (server)", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(fetchActiveModulesUser).toHaveBeenCalledWith("srv1");
    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(registered.has("quests")).toBe(true);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("does not load a module that is not active", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(loadQuests).not.toHaveBeenCalled();
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("is idempotent — a second call with the same source is a no-op while not idle", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });
    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(fetchActiveModulesUser).toHaveBeenCalledTimes(1);
  });

  it("resets to idle and clears mountedIds when fetchActiveModulesUser rejects", async () => {
    vi.mocked(fetchActiveModulesUser).mockRejectedValue(new Error("network"));

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(useModulesStore.getState().status).toBe("idle");
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("refetches when the active source changes (server switch is not swallowed)", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValueOnce([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);

    vi.mocked(fetchActiveModulesUser).mockResolvedValueOnce([]);
    await useModulesStore.getState().integrate({ serverId: "srv2" });

    expect(fetchActiveModulesUser).toHaveBeenCalledTimes(2);
    expect(fetchActiveModulesUser).toHaveBeenNthCalledWith(1, "srv1");
    expect(fetchActiveModulesUser).toHaveBeenNthCalledWith(2, "srv2");
    expect(useModulesStore.getState().mountedIds).toEqual([]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("ignores a stale resolver — A resolves after B, state reflects B", async () => {
    let resolveA: (v: { id: string; version: string }[]) => void;
    const pendingA = new Promise<{ id: string; version: string }[]>((resolve) => {
      resolveA = resolve;
    });
    vi.mocked(fetchActiveModulesUser)
      .mockImplementationOnce(() => pendingA)
      .mockResolvedValueOnce([]);

    const integrateA = useModulesStore.getState().integrate({ serverId: "srv1" });
    const integrateB = useModulesStore.getState().integrate({ serverId: "srv2" });
    await integrateB;
    expect(useModulesStore.getState().loadedKey).toBe("u:srv2");

    resolveA!([{ id: "quests", version: "1.0.0" }]);
    await integrateA;

    expect(useModulesStore.getState().loadedKey).toBe("u:srv2");
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("prefers the bundle the server serves over the copy built into the editor", async () => {
    const fromJar = { id: "quests", displayName: "Quests (jar)", routes: [] };
    vi.mocked(loadRuntimeBundle).mockResolvedValue(fromJar as never);
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([
      { id: "quests", version: "1.0.0", editor_bundle: { sdk: "1.0", hash: "abc" } },
    ]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(loadRuntimeBundle).toHaveBeenCalledWith("srv1", "quests", { sdk: "1.0", hash: "abc" });
    expect(loadQuests).not.toHaveBeenCalled();
    expect(registered.get("quests")).toBe(fromJar);
    expect(useModulesStore.getState().origins).toEqual({ quests: "bundle" });
  });

  it("marks a bundle read from a file on the server's disk as local", async () => {
    vi.mocked(loadRuntimeBundle).mockResolvedValue({ id: "quests", routes: [] } as never);
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([
      { id: "quests", version: "1.0.0", editor_bundle: { sdk: "1.2", hash: "def", local: true } },
    ]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(useModulesStore.getState().origins).toEqual({ quests: "local" });
  });

  it("falls back to the built-in copy and reports a refused bundle", async () => {
    vi.mocked(loadRuntimeBundle).mockRejectedValue(
      new BundleError({ reason: "older-editor", sdk: "2.0" }),
    );
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([
      { id: "quests", version: "1.0.0", editor_bundle: { sdk: "2.0", hash: "abc" } },
    ]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().origins).toEqual({ quests: "editor" });
    expect(useModulesStore.getState().refused).toEqual({
      quests: { reason: "older-editor", sdk: "2.0" },
    });
  });

  it("keeps the other modules when one view fails to load", async () => {
    vi.mocked(loadRuntimeBundle).mockRejectedValue(new Error("boom"));
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([
      { id: "broken", version: "1.0.0", editor_bundle: { sdk: "1.0", hash: "x" } },
      { id: "quests", version: "1.0.0" },
    ]);

    await useModulesStore.getState().integrate({ serverId: "srv1" });

    expect(useModulesStore.getState().status).toBe("ready");
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(Object.keys(useModulesStore.getState().refused)).toEqual(["broken"]);
  });
});
