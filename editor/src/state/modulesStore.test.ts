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

import { fetchActiveModulesUser } from "@/lib/api/modules";
import { useModulesStore } from "./modulesStore";

beforeEach(() => {
  registered.clear();
  loadQuests.mockClear();
  vi.mocked(fetchActiveModulesUser).mockClear();
  useModulesStore.setState({ mountedIds: [], status: "idle", loadedKey: null });
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
});
