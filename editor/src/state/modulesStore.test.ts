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
vi.mock("@/lib/api/modules", () => ({ fetchActiveModules: vi.fn() }));
vi.mock("@/distribution/modules.manifest", () => ({
  MODULE_MANIFEST: [{ id: "quests", load: loadQuests }],
}));

import { fetchActiveModules } from "@/lib/api/modules";
import { useModulesStore } from "./modulesStore";

beforeEach(() => {
  registered.clear();
  loadQuests.mockClear();
  vi.mocked(fetchActiveModules).mockClear();
  useModulesStore.setState({ mountedIds: [], status: "idle" });
});

describe("useModulesStore.integrate", () => {
  it("loads + registers an active external module and lists it", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(registered.has("quests")).toBe(true);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("does not load a module that is not active", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([]);

    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).not.toHaveBeenCalled();
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("is idempotent — a second call is a no-op while not idle", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate("tok");
    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(fetchActiveModules).toHaveBeenCalledTimes(1);
  });
});
