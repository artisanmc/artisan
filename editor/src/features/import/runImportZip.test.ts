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

vi.mock("@/features/export/projectZip", async (importOriginal) => ({
  folderFromZipName: (await importOriginal<typeof import("@/features/export/projectZip")>())
    .folderFromZipName,
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

  it("names the module after the archive when its files sit at the root (an export)", async () => {
    mocks.readProjectZip.mockResolvedValue({ "artisan-module.yml": "schema: module/v1\n" });
    mocks.normalizeProjectFiles.mockImplementation(() => {
      throw new Error("stop");
    });
    await prepareImportZip(new File(["zip"], "daily (1).zip"), target, "merge");
    expect(mocks.normalizeProjectFiles).toHaveBeenCalledWith(
      { "artisan-module.yml": "schema: module/v1\n" },
      undefined,
      "daily",
    );
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

describe("an archive that says what the module names elsewhere", () => {
  const P = "plugins/Artisan/projects/shop/";
  const frame = new Uint8Array([1, 2, 3]);
  const blason = new Uint8Array([4, 5, 6]);
  const note = [
    "schema: export/v1",
    "artisan: 1.4.0",
    "base: [close.1x1, medal.1x1]",
    "common: [blason, frame]",
    "requires:",
    "  common: [ribbon]",
    "  modules:",
    "    guilds: [crest, banner]",
    "    warps: [pin]",
    "",
  ].join("\n");
  const archive = () =>
    normalized({
      [`${P}artisan-module.yml`]: "schema: module/v1\n",
      [`${P}artisan-export.yml`]: note,
      [`${P}menus/a.yml`]: "name: a\n",
      [`${P}assets/textures/frame.png`]: frame,
      [`${P}assets/textures/frame.yml`]: "ramps: true\n",
      [`${P}assets/glyphs/blason.png`]: blason,
      [`${P}assets/glyphs/blason.yml`]: "codepoint: 57345\n",
    });
  const kitSummary = { id: "proj_kit", externalId: "artisan", name: "artisan", role: "theme" };
  const guildsSummary = { id: "proj_guilds", externalId: "guilds", name: "guilds" };

  it("leaves out the copies the server has the same common image for, keeps the others, and lists what the server lacks", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(archive());
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["artisan", "guilds"],
      projects: [kitSummary, guildsSummary],
    });
    const frameHash = await hashBytes(frame);
    mocks.readProjectFiles.mockImplementation(async ({ diskId }: { diskId: string }) =>
      diskId === "artisan"
        ? {
            ok: true,
            files: {},
            binaries: [
              { path: "assets/textures/frame.png", hash: frameHash, size: 3 },
              // The server's own image under that name: the module keeps the origin's.
              { path: "assets/textures/blason.png", hash: "another", size: 3 },
              { path: "originals/assets/textures/close.1x1.png", hash: "c", size: 1 },
            ],
            failed: [],
            hash: "h",
          }
        : {
            ok: true,
            files: {},
            binaries: [{ path: "assets/textures/crest.png", hash: "x", size: 1 }],
            failed: [],
            hash: "h",
          },
    );

    const result = await prepareImportZip(file, target, "merge");
    if (!result.ok) throw new Error("expected preview");
    const { preview } = result;
    expect(preview.elsewhere).toEqual({
      dropped: ["frame"],
      kept: ["blason"],
      artisan: "1.4.0",
      base: ["medal.1x1"],
      common: ["ribbon"],
      modules: [
        { folder: "guilds", images: ["banner"], absent: false },
        { folder: "warps", images: ["pin"], absent: true },
      ],
    });
    // The note is about the archive, and the dropped copy goes with its descriptor.
    expect(Object.keys(preview.input.files).sort()).toEqual([
      "artisan-module.yml",
      "assets/glyphs/blason.yml",
      "menus/a.yml",
    ]);
    expect(Object.keys(preview.input.binaries)).toEqual(["assets/glyphs/blason.png"]);
    expect(preview.diff.additions).not.toContain("assets/textures/frame.png");
  });

  it("keeps every copy on a server without common images, and never writes the note", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(archive());
    mocks.listServerProjects.mockResolvedValue({ ok: true, projectIds: [], projects: [] });

    const result = await prepareImportZip(file, target, "merge");
    if (!result.ok) throw new Error("expected preview");
    expect(result.preview.elsewhere).toMatchObject({ dropped: [], kept: ["blason", "frame"] });
    expect(result.preview.input.files["artisan-export.yml"]).toBeUndefined();
    expect(mocks.readProjectFiles).not.toHaveBeenCalled();
  });

  it("drops a note that is not one, without settling anything", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(
      normalized({
        [`${P}artisan-module.yml`]: "schema: module/v1\n",
        [`${P}artisan-export.yml`]: "schema: other/v9\n",
      }),
    );
    mocks.listServerProjects.mockResolvedValue({ ok: true, projectIds: [], projects: [] });
    const result = await prepareImportZip(file, target, "merge");
    if (!result.ok) throw new Error("expected preview");
    expect(result.preview.elsewhere).toBeUndefined();
    expect(Object.keys(result.preview.input.files)).toEqual(["artisan-module.yml"]);
  });

  it("fails when the server's common images cannot be read: nothing is settled blind", async () => {
    mocks.readProjectZip.mockResolvedValue({});
    mocks.normalizeProjectFiles.mockReturnValue(archive());
    mocks.listServerProjects.mockResolvedValue({
      ok: true,
      projectIds: ["artisan"],
      projects: [kitSummary],
    });
    mocks.readProjectFiles.mockResolvedValue({ ok: false, error: "server_offline" });
    expect(await prepareImportZip(file, target, "merge")).toEqual({
      ok: false,
      error: "server_offline",
    });
  });
});
