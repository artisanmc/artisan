import { usePersistedDraftStore } from "@/features/project/persistedDrafts";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { libraryDraftAssets } from "./kitAssets";
import { addToLibrary, libraryFor, openLibraryDraft } from "./libraryDraft";

const readProjectFiles = vi.fn();
const uploadAsset = vi.fn();
const loadPersistedDrafts = vi.fn();
vi.mock("@/lib/api/projectFiles", () => ({
  readProjectFiles: (...args: unknown[]) => readProjectFiles(...args),
}));
vi.mock("@/lib/api/userAssets", () => ({
  uploadAsset: (...args: unknown[]) => uploadAsset(...args),
}));
vi.mock("@/lib/projectPrincipal", () => ({
  projectPrincipal: { current: () => ({ kind: "player", id: "u1" }) },
}));
vi.mock("@/features/project/persistedDrafts", async () => {
  const { create } = await import("zustand");
  return {
    usePersistedDraftStore: create(() => ({ sessions: {} as Record<string, unknown> })),
    loadPersistedDrafts: (...args: unknown[]) => loadPersistedDrafts(...args),
  };
});

const kit = (byName: boolean) => ({
  read: { projectId: "srv.artisan", files: {}, binaries: [], byName },
  own: { noel: { projectId: "srv.noel", files: {}, binaries: [] } },
});

describe("libraryFor", () => {
  it("is the library for a module, and nothing for the library, a theme or an older server", () => {
    expect(libraryFor("srv.shop", kit(true))).toBe("srv.artisan");
    expect(libraryFor("srv.artisan", kit(true))).toBeNull();
    expect(libraryFor("srv.noel", kit(true))).toBeNull();
    expect(libraryFor("srv.shop", kit(false))).toBeNull();
    expect(libraryFor("srv.shop", { read: undefined, own: {} })).toBeNull();
  });
});

describe("addToLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePersistedDraftStore.setState({ sessions: {} });
    useProjectBaselineStore.getState().clear("srv.artisan");
    loadPersistedDrafts.mockImplementation(async (projectId: string, ownerId: string) => {
      usePersistedDraftStore.setState({
        sessions: { [projectId]: { ownerId, drafts: [], status: "saved" } } as never,
      });
    });
    uploadAsset.mockResolvedValue({ id: "crest", projectId: "srv.artisan", name: "crest" });
  });

  it("opens the library's draft on its published files, once, then writes the image there", async () => {
    readProjectFiles.mockResolvedValue({
      ok: true,
      files: { "artisan.yml": "name: artisan\n" },
      binaries: [{ path: "assets/textures/cell.png", hash: "h1", size: 9 }],
    });
    const file = new File([new Uint8Array([1])], "crest.png", { type: "image/png" });
    const asset = await addToLibrary("srv.artisan", { file, name: "crest", usages: ["button"] });
    expect(asset.projectId).toBe("srv.artisan");
    expect(useProjectBaselineStore.getState().get("srv.artisan")).toEqual({
      "artisan.yml": "name: artisan\n",
    });
    expect(useProjectBaselineStore.getState().binaryBaselines["srv.artisan"]).toEqual({
      "assets/textures/cell.png": { hash: "h1", size: 9 },
    });
    expect(loadPersistedDrafts).toHaveBeenCalledWith("srv.artisan", "u1");
    expect(uploadAsset).toHaveBeenCalledWith("srv.artisan", {
      file,
      name: "crest",
      usages: ["button"],
      type: "glyph",
    });
    await addToLibrary("srv.artisan", { file, name: "crest2" });
    expect(readProjectFiles).toHaveBeenCalledTimes(1);
    expect(loadPersistedDrafts).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the library cannot be read", async () => {
    readProjectFiles.mockResolvedValue({ ok: false, error: "offline" });
    await expect(openLibraryDraft("srv.artisan")).rejects.toThrow("draft_unavailable");
    expect(loadPersistedDrafts).not.toHaveBeenCalled();
  });
});

describe("libraryDraftAssets", () => {
  const read = {
    projectId: "srv.artisan",
    files: {},
    binaries: [{ path: "assets/textures/cell.png", hash: "h1" }],
  };

  it("lists what the draft adds or redraws, drawn from the draft's blobs", () => {
    const assets = libraryDraftAssets(read, {
      tree: { "assets/glyphs/crest.yml": "width: 40\nheight: 12\n" },
      binaryTree: {
        "assets/textures/cell.png": { hash: "h1" },
        "assets/glyphs/crest.png": { hash: "h2" },
      },
      remote: { id: "d1", revision: 3 },
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ id: "kit:crest", width: 40, height: 12, contentHash: "h2" });
    expect(assets[0]?.previewUrl).toContain("/user/projects/srv.artisan/drafts/d1/blobs/h2");
  });

  it("lists nothing without a draft on the hub, or when the draft holds the published files", () => {
    expect(libraryDraftAssets(read, undefined)).toEqual([]);
    expect(
      libraryDraftAssets(read, {
        tree: {},
        binaryTree: { "assets/glyphs/crest.png": { hash: "h2" } },
        remote: { id: "d1", revision: 0 },
      }),
    ).toEqual([]);
    expect(
      libraryDraftAssets(read, {
        tree: {},
        binaryTree: { "assets/textures/cell.png": { hash: "h1" } },
        remote: { id: "d1", revision: 2 },
      }),
    ).toEqual([]);
  });
});
