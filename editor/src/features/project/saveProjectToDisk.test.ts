import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveProjectToDisk } from "./saveProjectToDisk";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import type { Project, ProjectId } from "@/domain/types";

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
  beforeEach(() => {
    vi.mocked(writeProjectFiles).mockReset();
    useProjectBaselineStore.setState({ baselines: {} });
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

  it("écrit sous l'id disque, pas l'id interne", async () => {
    vi.mocked(writeProjectFiles).mockResolvedValue({ ok: true });

    await saveProjectToDisk(emptyProject(), "n1", "s1");

    expect(writeProjectFiles).toHaveBeenCalledWith("n1", "s1", "boutique_shop", expect.anything());
  });
});
