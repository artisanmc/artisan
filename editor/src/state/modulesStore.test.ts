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
  fetchActiveModules: vi.fn(),
  fetchActiveModulesUser: vi.fn(),
}));
vi.mock("@/distribution/modules.manifest", () => ({
  MODULE_MANIFEST: [{ id: "quests", load: loadQuests }],
}));

import { fetchActiveModules, fetchActiveModulesUser } from "@/lib/api/modules";
import { useModulesStore } from "./modulesStore";

beforeEach(() => {
  registered.clear();
  loadQuests.mockClear();
  vi.mocked(fetchActiveModules).mockClear();
  vi.mocked(fetchActiveModulesUser).mockClear();
  useModulesStore.setState({ mountedIds: [], status: "idle", loadedKey: null });
});

describe("useModulesStore.integrate — session source", () => {
  it("loads + registers an active external module and lists it", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ token: "tok" });

    expect(fetchActiveModules).toHaveBeenCalledWith("tok");
    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(registered.has("quests")).toBe(true);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("does not load a module that is not active", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([]);

    await useModulesStore.getState().integrate({ token: "tok" });

    expect(loadQuests).not.toHaveBeenCalled();
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("is idempotent — a second call with the same source is a no-op while not idle", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ token: "tok" });
    await useModulesStore.getState().integrate({ token: "tok" });

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(fetchActiveModules).toHaveBeenCalledTimes(1);
  });

  it("resets to idle and clears mountedIds when fetchActiveModules rejects", async () => {
    vi.mocked(fetchActiveModules).mockRejectedValue(new Error("network"));

    await useModulesStore.getState().integrate({ token: "tok" });

    expect(useModulesStore.getState().status).toBe("idle");
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });
});

describe("useModulesStore.integrate — user source", () => {
  it("fetches presence via the user-scoped endpoint (network+server, no token)", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ networkId: "net1", serverId: "srv1" });

    expect(fetchActiveModulesUser).toHaveBeenCalledWith("net1", "srv1");
    expect(fetchActiveModules).not.toHaveBeenCalled();
    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("refetches when the active source changes (server switch is not swallowed)", async () => {
    vi.mocked(fetchActiveModulesUser).mockResolvedValueOnce([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate({ networkId: "net1", serverId: "srv1" });
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);

    vi.mocked(fetchActiveModulesUser).mockResolvedValueOnce([]);
    await useModulesStore.getState().integrate({ networkId: "net1", serverId: "srv2" });

    expect(fetchActiveModulesUser).toHaveBeenCalledTimes(2);
    expect(fetchActiveModulesUser).toHaveBeenNthCalledWith(1, "net1", "srv1");
    expect(fetchActiveModulesUser).toHaveBeenNthCalledWith(2, "net1", "srv2");
    expect(useModulesStore.getState().mountedIds).toEqual([]);
    expect(useModulesStore.getState().status).toBe("ready");
  });
});
