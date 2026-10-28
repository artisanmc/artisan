import type { IndexedRead } from "@/features/serverIndex/serverIndexLoader";
import * as userProjectsApi from "@/lib/api/userProjects";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedProjectCache } from "./seedProjectCache";

const read = (id: string, hash: string): IndexedRead => ({
  summary: { id, name: id, externalId: id, hash, serverKeyId: "sk_1" },
  files: { "manifest.yaml": `id: ${id}\n` },
  binaries: [],
  failed: [],
  hash,
});

const identity = (id: string) => ({
  project: { id, name: id, externalId: id, serverKeyId: "sk_1" },
  serverKeyId: "sk_1",
});

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectCacheStore.setState({ entries: {}, reloadToken: 0 } as never);
  useProjectRuntimeStore.getState().set(null);
});

describe("seedProjectCache", () => {
  it("makes a never-opened Project a known version, under the key navigation uses", async () => {
    const load = vi
      .spyOn(userProjectsApi, "loadUserProject")
      .mockResolvedValue(identity("shop") as never);

    await seedProjectCache("survie", "u1", [read("shop", "h1")]);

    expect(load).toHaveBeenCalledWith("shop", "survie");
    const entry = useProjectCacheStore.getState().get(projectCacheKey("shop", "survie", "u1"));
    expect(entry?.hash).toBe("h1");
    expect(entry?.tree).toEqual({ "manifest.yaml": "id: shop\n" });
    expect(entry?.diskId).toBe("shop");
  });

  it("refreshes a known version without asking the hub again", async () => {
    const key = projectCacheKey("shop", "survie", "u1");
    useProjectCacheStore.getState().put(key, {
      identity: identity("shop"),
      diskId: "shop",
      serverKeyId: "sk_1",
      tree: {},
      hash: "old",
      declaredModels: [{ id: "m" }],
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    const load = vi.spyOn(userProjectsApi, "loadUserProject");

    await seedProjectCache("survie", "u1", [read("shop", "new")]);

    expect(load).not.toHaveBeenCalled();
    const entry = useProjectCacheStore.getState().get(key);
    expect(entry?.hash).toBe("new");
    expect(entry?.declaredModels).toEqual([{ id: "m" }]);
  });

  it("leaves the open Project's entry to its loader", async () => {
    const key = projectCacheKey("shop", "survie", "u1");
    useProjectCacheStore.getState().put(key, {
      identity: identity("shop"),
      diskId: "shop",
      tree: {},
      hash: "old",
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    useProjectRuntimeStore.getState().set({
      projectId: "shop",
      serverId: "sk_1",
      minecraftVersion: null,
      capabilities: {} as never,
      connection: { available: true },
    });

    await seedProjectCache("survie", "u1", [read("shop", "new")]);

    expect(useProjectCacheStore.getState().get(key)?.hash).toBe("old");
  });

  it("an identity the hub refuses seeds nothing", async () => {
    vi.spyOn(userProjectsApi, "loadUserProject").mockRejectedValue(new Error("forbidden"));

    await seedProjectCache("survie", "u1", [read("shop", "h1")]);

    expect(useProjectCacheStore.getState().entries).toEqual({});
  });
});
