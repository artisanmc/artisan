import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readProjectZip: vi.fn(),
  normalizeProjectFiles: vi.fn(),
  createProject: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  uploadDraftBlob: vi.fn(),
  listServerProjects: vi.fn(),
  readProjectFiles: vi.fn(),
  loadUserProject: vi.fn(),
}));

vi.mock("@/features/export/projectZip", () => ({
  readProjectZip: mocks.readProjectZip,
  normalizeProjectFiles: mocks.normalizeProjectFiles,
}));
vi.mock("@/lib/api/servers", () => ({ createProject: mocks.createProject }));
vi.mock("@/lib/api/projectDrafts", () => ({
  createDraft: mocks.createDraft,
  updateDraft: mocks.updateDraft,
  uploadDraftBlob: mocks.uploadDraftBlob,
}));
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: mocks.listServerProjects,
  readProjectFiles: mocks.readProjectFiles,
}));
vi.mock("@/lib/api/userProjects", () => ({ loadUserProject: mocks.loadUserProject }));

import { hashBytes } from "@/lib/contentHash";
import { applyImportZip, prepareImportZip } from "./runImportZip";

const target = { serverId: "sk1" };
const file = new Blob(["zip"]);

const shopSummary = {
  id: "proj_shop",
  externalId: "shop",
  name: "shop",
  hash: "h",
  serverKeyId: "sk1",
};

function normalized(files: Record<string, string | Uint8Array>) {
  return { projectId: "shop", files };
}

async function hashMeta(content: string): Promise<{ hash: string; size: number }> {
  const bytes = new TextEncoder().encode(content);
  return { hash: await hashBytes(bytes), size: bytes.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDraft.mockResolvedValue({ revision: 1, id: "d1" });
  mocks.updateDraft.mockResolvedValue({ revision: 2, id: "d1" });
  mocks.uploadDraftBlob.mockResolvedValue({ revision: 1, id: "d1" });
});

describe("prepareImportZip", () => {
  it("rejects an archive without a manifest", async () => {
    mocks.readProjectZip.mockRejectedValue(new Error("no_manifest"));
    const result = await prepareImportZip(file, target, "merge");
    expect(result).toEqual({ ok: false, error: "no_manifest" });
  });

  it("reads the server snapshot for an existing project", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({
        "plugins/Artisan/projects/shop/manifest.yaml": "id: shop\n",
        "plugins/Artisan/projects/shop/menus/a.yaml": "import\n",
      }),
    );
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["shop"],
      projects: [shopSummary],
    });
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: shop\n", "menus/a.yaml": "server\n" },
      binaries: [],
      failed: [],
      hash: "h",
    });

    const result = await prepareImportZip(file, target, "merge");
    if (!result.ok) throw new Error("expected preview");
    expect(result.preview.exists).toBe(true);
    expect(result.preview.projectRef).toBe("proj_shop");
    expect(result.preview.diff.conflicts.map((c) => c.path)).toEqual(["menus/a.yaml"]);
    expect(result.preview.diff.identical).toEqual(["manifest.yaml"]);
  });
});

describe("applyImportZip", () => {
  it("creates the Project and its draft for a new project", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({
        "plugins/Artisan/projects/shop/manifest.yaml": "id: shop\n",
        "plugins/Artisan/projects/shop/menus/a.yaml": "name: a\n",
      }),
    );
    mocks.listServerProjects.mockResolvedValue({ ok: true, projectIds: [], projects: [] });
    mocks.createProject.mockResolvedValue(shopSummary);
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: {},
      binaries: [],
      failed: [],
      hash: "h",
    });

    const prepared = await prepareImportZip(file, target, "merge");
    if (!prepared.ok) throw new Error("expected preview");
    const result = await applyImportZip(prepared.preview);

    expect(result).toMatchObject({ ok: true, projectId: "shop", created: true });
    expect(mocks.createProject).toHaveBeenCalledWith("sk1", "shop");
    expect(mocks.createDraft.mock.calls[0]![0]).toBe("proj_shop");
    const snapshot = mocks.createDraft.mock.calls[0]![3];
    expect(snapshot.baseline).toEqual({});
    expect(snapshot.tree).toEqual({
      "menus/a.yaml": "name: a\n",
      "manifest.yaml": "id: shop\n",
    });
  });

  it("resolves the anchor when the server already has the project (project_exists)", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({ "plugins/Artisan/projects/shop/menus/a.yaml": "v: 1\n" }),
    );
    mocks.listServerProjects.mockResolvedValue({ ok: true, projectIds: [], projects: [] });
    mocks.createProject.mockRejectedValue(new Error("project_exists"));
    mocks.loadUserProject.mockResolvedValue({ project: { id: "proj_shop" } });
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: {},
      binaries: [],
      failed: [],
      hash: "h",
    });

    const prepared = await prepareImportZip(file, target, "merge");
    if (!prepared.ok) throw new Error("expected preview");
    const result = await applyImportZip(prepared.preview);

    expect(result).toMatchObject({ ok: true, projectId: "shop", created: false });
    expect(mocks.loadUserProject).toHaveBeenCalledWith("shop", "sk1");
    expect(mocks.createDraft.mock.calls[0]![0]).toBe("proj_shop");
  });

  it("a conflict settled as 'server' keeps the server's content in the draft", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({
        "plugins/Artisan/projects/shop/manifest.yaml": "id: shop\n",
        "plugins/Artisan/projects/shop/menus/a.yaml": "import\n",
      }),
    );
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["shop"],
      projects: [shopSummary],
    });
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: shop\n", "menus/a.yaml": "server\n" },
      binaries: [],
      failed: [],
      hash: "h",
    });

    const prepared = await prepareImportZip(file, target, "merge");
    if (!prepared.ok) throw new Error("expected preview");
    await applyImportZip(prepared.preview, { "menus/a.yaml": "server" });

    expect(mocks.readProjectFiles).toHaveBeenCalledWith({ serverId: "sk1", diskId: "shop" });
    expect(mocks.createDraft.mock.calls[0]![0]).toBe("proj_shop");
    const snapshot = mocks.createDraft.mock.calls[0]![3];
    expect(snapshot.tree["menus/a.yaml"]).toBe("server\n");
    expect(snapshot.baseline["menus/a.yaml"]).toBe("server\n");
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it("uploads the blobs of the modified images then updates the draft", async () => {
    const bytes = new TextEncoder().encode("new-image");
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({
        "plugins/Artisan/projects/shop/manifest.yaml": "id: shop\n",
        "plugins/Artisan/projects/shop/assets/icon.png": bytes,
      }),
    );
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["shop"],
      projects: [shopSummary],
    });
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: shop\n", "menus/a.yaml": "server\n" },
      binaries: [],
      failed: [],
      hash: "h",
    });

    const prepared = await prepareImportZip(file, target, "overwrite");
    if (!prepared.ok) throw new Error("expected preview");
    const result = await applyImportZip(prepared.preview);

    expect(result).toMatchObject({ ok: true, created: false });
    expect(mocks.uploadDraftBlob).toHaveBeenCalledTimes(1);
    expect(mocks.updateDraft).toHaveBeenCalledTimes(1);
    const updated = mocks.updateDraft.mock.calls[0]![4];
    expect(updated.binaryTree["assets/icon.png"].hash).toBe(await hashBytes(bytes));
  });

  it("in overwrite mode, removes from the draft the images missing from the archive even with no other modified image", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({ "plugins/Artisan/projects/shop/manifest.yaml": "id: shop\n" }),
    );
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["shop"],
      projects: [shopSummary],
    });
    mocks.readProjectFiles.mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: shop\n" },
      binaries: [{ path: "assets/old.png", hash: "h-old", size: 3 }],
      failed: [],
      hash: "h",
    });

    const prepared = await prepareImportZip(file, target, "overwrite");
    if (!prepared.ok) throw new Error("expected preview");
    expect(prepared.preview.diff.serverOnly).toEqual(["assets/old.png"]);
    await applyImportZip(prepared.preview);

    expect(mocks.uploadDraftBlob).not.toHaveBeenCalled();
    expect(mocks.updateDraft).toHaveBeenCalledTimes(1);
    expect(mocks.updateDraft.mock.calls[0]![4].binaryTree).toEqual({});
  });
});
