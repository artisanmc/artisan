import type { Project } from "@/domain/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listServerProjects = vi.fn();
const readProjectFiles = vi.fn();
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: (...args: unknown[]) => listServerProjects(...args),
  readProjectFiles: (...args: unknown[]) => readProjectFiles(...args),
}));

const projectFromFiles = vi.fn();
vi.mock("@/schema/projectFromFiles", () => ({
  projectFromFiles: (...args: unknown[]) => projectFromFiles(...args),
}));

import { clearServerIndexCache, loadServerProjects } from "./serverIndexLoader";

const summary = (id: string, name = id) => ({
  id,
  name,
  externalId: id,
  hash: "",
  networkId: "net",
  serverKeyId: "sk",
});

const tree = (diskId: string) => ({ "manifest.yaml": `# ${diskId}` });

beforeEach(() => {
  clearServerIndexCache();
  listServerProjects.mockReset();
  readProjectFiles.mockReset();
  projectFromFiles.mockReset();
  projectFromFiles.mockImplementation((id: string, _files: unknown, meta: { name?: string }) => ({
    id,
    name: meta.name,
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
  }));
});

describe("loadServerProjects", () => {
  it("reads every project of the server from its published tree", async () => {
    listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["main", "boutique"],
      projects: [summary("main", "Main"), summary("boutique", "Boutique")],
    });
    readProjectFiles.mockImplementation(async ({ diskId }: { diskId: string }) => ({
      ok: true,
      files: tree(diskId),
      failed: [],
      hash: `h-${diskId}`,
    }));

    const result = await loadServerProjects({ serverId: "srv" });

    expect(result.status).toBe("ready");
    expect(result.projects.map((p) => p.name)).toEqual(["Main", "Boutique"]);
    expect(readProjectFiles).toHaveBeenCalledWith({ serverId: "srv", diskId: "main" }, undefined);
    expect(readProjectFiles).toHaveBeenCalledWith(
      { serverId: "srv", diskId: "boutique" },
      undefined,
    );
  });

  it("parses each tree under its folder prefix, like the project loader does", async () => {
    listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["boutique"],
      projects: [summary("boutique")],
    });
    readProjectFiles.mockResolvedValue({
      ok: true,
      files: tree("boutique"),
      failed: [],
      hash: "h",
    });

    await loadServerProjects({ serverId: "srv" });

    const [id, files, meta] = projectFromFiles.mock.calls[0] as [
      string,
      Record<string, string>,
      Record<string, unknown>,
    ];
    expect(id).toBe("boutique");
    expect(Object.keys(files)).toEqual(["plugins/Artisan/projects/boutique/manifest.yaml"]);
    expect(meta).toMatchObject({ name: "boutique", diskId: "boutique", serverKeyId: "sk" });
  });

  it("revalidates by hash and reuses what it already parsed when nothing changed", async () => {
    listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["main"],
      projects: [summary("main")],
    });
    readProjectFiles.mockResolvedValueOnce({
      ok: true,
      files: tree("main"),
      failed: [],
      hash: "h1",
    });
    const first = await loadServerProjects({ serverId: "srv" });

    readProjectFiles.mockResolvedValueOnce({ ok: true, unchanged: true, hash: "h1" });
    const second = await loadServerProjects({ serverId: "srv" });

    expect(readProjectFiles).toHaveBeenLastCalledWith({ serverId: "srv", diskId: "main" }, "h1");
    expect(projectFromFiles).toHaveBeenCalledTimes(1);
    expect(second.projects[0]).toBe(first.projects[0] as Project);
  });

  it("reports an unreadable project without dropping the others", async () => {
    listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["main", "cassé"],
      projects: [summary("main"), summary("cassé")],
    });
    readProjectFiles.mockImplementation(async ({ diskId }: { diskId: string }) =>
      diskId === "cassé"
        ? { ok: false, error: "read_error" }
        : { ok: true, files: tree(diskId), failed: [], hash: "h" },
    );

    const result = await loadServerProjects({ serverId: "srv" });

    expect(result.status).toBe("ready");
    expect(result.projects.map((p) => p.id)).toEqual(["main"]);
    expect(result.failed).toEqual(["cassé"]);
  });

  it("reports an unparseable tree as failed instead of throwing", async () => {
    listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["main"],
      projects: [summary("main")],
    });
    readProjectFiles.mockResolvedValue({ ok: true, files: tree("main"), failed: [], hash: "h" });
    projectFromFiles.mockImplementation(() => {
      throw new Error("bad yaml");
    });

    const result = await loadServerProjects({ serverId: "srv" });

    expect(result.projects).toEqual([]);
    expect(result.failed).toEqual(["main"]);
  });

  it("says so when the server's projects cannot be listed", async () => {
    listServerProjects.mockResolvedValue({ ok: false, error: "server_offline" });

    const result = await loadServerProjects({ serverId: "srv" });

    expect(result).toEqual({ status: "unavailable", projects: [], failed: [] });
    expect(readProjectFiles).not.toHaveBeenCalled();
  });
});
