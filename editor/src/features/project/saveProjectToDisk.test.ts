import type { Project, ProjectId } from "@/domain/types";
import { DraftApiError } from "@/lib/api/projectDrafts";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as persistedDrafts from "./persistedDrafts";
import { projectTree, saveProjectToDisk } from "./saveProjectToDisk";

vi.mock("@/lib/api/projectFiles", () => ({ writeProjectFiles: vi.fn() }));

function emptyProject(): Project {
  return {
    id: "p1" as ProjectId,
    diskId: "boutique_shop",
    name: "Boutique",
    menus: [],
    commands: [],
    dialogs: [],
    i18nKeys: {},
    translations: {},
    dataSources: [],
    dataModels: [],
    itemTemplates: [],
    canvasLayout: [],
  } as unknown as Project;
}

describe("saveProjectToDisk", () => {
  it("preserves the draft publication error and HTTP status without advancing the baseline", async () => {
    persistedDrafts.usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saved" } },
    });
    vi.spyOn(persistedDrafts, "publishPersistedDraft").mockRejectedValue(
      new DraftApiError(
        "write_error",
        422,
        undefined,
        [],
        [],
        "AccessDeniedException: menus/shop.yaml",
      ),
    );
    expect(await saveProjectToDisk(emptyProject(), "n1", "s1")).toMatchObject({
      ok: false,
      code: "write_error",
      status: 422,
      message: "AccessDeniedException: menus/shop.yaml",
    });
    expect(useProjectBaselineStore.getState().get("p1")).toBeUndefined();
    expect(useProjectDraftStore.getState().get("p1")).toBeDefined();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    persistedDrafts.usePersistedDraftStore.setState({ sessions: {} });
    vi.mocked(writeProjectFiles).mockReset();
    useProjectBaselineStore.setState({ baselines: {} });
  });

  it("publishes through the backend draft when a draft session is active", async () => {
    persistedDrafts.usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saved" } },
    });
    const publish = vi
      .spyOn(persistedDrafts, "publishPersistedDraft")
      .mockResolvedValue({ wrote: 1, tree: projectTree(emptyProject()) });
    const result = await saveProjectToDisk(emptyProject(), "n1", "s1");
    expect(result).toEqual({ ok: true, wrote: 1 });
    expect(publish).toHaveBeenCalledWith("p1");
    expect(writeProjectFiles).not.toHaveBeenCalled();
    expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
  });

  it("n'écrit rien quand l'arbre est identique à la base", async () => {
    const project = emptyProject();
    // Première passe : on capture ce que le project produit, et on en fait la base.
    vi.mocked(writeProjectFiles).mockResolvedValue({ ok: true });
    await saveProjectToDisk(project, "n1", "s1");
    vi.mocked(writeProjectFiles).mockClear();

    const second = await saveProjectToDisk(project, "n1", "s1");

    expect(second).toEqual({ ok: true, wrote: 0 });
    expect(writeProjectFiles).not.toHaveBeenCalled();
  });

  it("rebases a rename continued while publication was pending", async () => {
    persistedDrafts.usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saved" } },
    });
    const published = { "menus/b.yaml": "menu" };
    vi.spyOn(persistedDrafts, "publishPersistedDraft").mockImplementation(async () => {
      useProjectDraftStore.getState().save("p1", {
        baseline: { "menus/a.yaml": "menu" },
        tree: { "menus/c.yaml": "menu" },
        at: 1,
      });
      useProjectDraftStore.setState({
        pendingRenames: { p1: [{ from: "menus/a.yaml", to: "menus/c.yaml" }] },
      });
      return { wrote: 1, tree: published, renames: [{ from: "menus/a.yaml", to: "menus/b.yaml" }] };
    });
    expect(await saveProjectToDisk(emptyProject(), "n1", "s1")).toEqual({ ok: true, wrote: 1 });
    expect(useProjectDraftStore.getState().get("p1")?.baseline).toEqual(published);
    expect(useProjectDraftStore.getState().pendingRenames.p1).toEqual([
      { from: "menus/b.yaml", to: "menus/c.yaml" },
    ]);
  });

  it("keeps binary edits made while the unchanged text tree was published", async () => {
    persistedDrafts.usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saved" } },
    });
    const tree = projectTree(emptyProject());
    const before = { "assets/icon.png": { hash: "old", size: 2 } };
    const after = { "assets/icon.png": { hash: "new", size: 3 } };
    vi.spyOn(persistedDrafts, "publishPersistedDraft").mockImplementation(async () => {
      useProjectDraftStore
        .getState()
        .save("p1", { baseline: tree, tree, at: 1, binaryTree: after });
      return { wrote: 1, tree, binaryTree: before };
    });
    expect(await saveProjectToDisk(emptyProject(), "n1", "s1")).toEqual({ ok: true, wrote: 1 });
    expect(useProjectDraftStore.getState().get("p1")?.binaryTree).toEqual(after);
    expect(useProjectDraftStore.getState().get("p1")?.binaryBaseline).toEqual(before);
  });

  it("un enregistrement réussi devient la nouvelle base", async () => {
    const project = emptyProject();
    vi.mocked(writeProjectFiles).mockResolvedValue({ ok: true });

    await saveProjectToDisk(project, "n1", "s1");

    const baseline = useProjectBaselineStore.getState().get("p1");
    expect(baseline).toBeDefined();
    expect(Object.keys(baseline!).length).toBeGreaterThan(0);
    // Les chemins sont relatifs au project, jamais canoniques.
    expect(Object.keys(baseline!).every((p) => !p.startsWith("plugins/"))).toBe(true);
  });

  it("un conflit n'avance pas la base — rien n'a été écrit sur disque", async () => {
    const project = emptyProject();
    vi.mocked(writeProjectFiles).mockResolvedValue({
      ok: false,
      error: "conflict",
      conflicts: [{ path: "manifest.yaml", disk: "id: autre\n" }],
      diskFiles: ["manifest.yaml"],
    });

    const res = await saveProjectToDisk(project, "n1", "s1");

    expect(res).toEqual({
      ok: false,
      error: "conflict",
      conflicts: [{ path: "manifest.yaml", disk: "id: autre\n" }],
      diskFiles: ["manifest.yaml"],
    });
    expect(useProjectBaselineStore.getState().get("p1")).toBeUndefined();
  });

  it("remonte une panne de serveur telle quelle", async () => {
    vi.mocked(writeProjectFiles).mockResolvedValue({ ok: false, error: "server_offline" });

    const res = await saveProjectToDisk(emptyProject(), "n1", "s1");

    expect(res).toEqual({ ok: false, error: "server_offline" });
    expect(useProjectBaselineStore.getState().get("p1")).toBeUndefined();
  });

  it("binds publication to immutable project identity", async () => {
    vi.mocked(writeProjectFiles).mockResolvedValue({ ok: true });

    await saveProjectToDisk(emptyProject(), "n1", "s1");

    expect(writeProjectFiles).toHaveBeenCalledWith("p1", undefined, undefined, expect.anything());
  });
});
