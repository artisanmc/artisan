import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeDraftFile } from "./draftFile";

const ensurePersistedDraft = vi.fn();
const openLibraryDraft = vi.fn();
vi.mock("@/features/project/persistedDrafts", () => ({
  ensurePersistedDraft: (...args: unknown[]) => ensurePersistedDraft(...args),
}));
vi.mock("./libraryDraft", () => ({
  openLibraryDraft: (...args: unknown[]) => openLibraryDraft(...args),
}));

describe("writeDraftFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistedDraft.mockResolvedValue(undefined);
    openLibraryDraft.mockResolvedValue(undefined);
    useProjectDraftStore.setState({ drafts: {} });
    useProjectBaselineStore.getState().clear("srv.noel");
  });

  it("starts a draft from the published files and writes the file in it", async () => {
    useProjectBaselineStore.getState().set("srv.noel", { "project.yml": "name: noel\n" });
    await writeDraftFile("srv.noel", "palette.yml", 'primary: "#112233"\n');
    expect(openLibraryDraft).toHaveBeenCalledWith("srv.noel");
    const draft = useProjectDraftStore.getState().get("srv.noel")!;
    expect(draft.baseline).toEqual({ "project.yml": "name: noel\n" });
    expect(draft.tree).toEqual({
      "project.yml": "name: noel\n",
      "palette.yml": 'primary: "#112233"\n',
    });
    expect(ensurePersistedDraft).toHaveBeenCalledWith("srv.noel");
  });

  it("changes the draft held, takes a file off, and sends nothing for no change", async () => {
    useProjectDraftStore.getState().save("srv.noel", {
      baseline: { "palette.yml": "a" },
      tree: { "palette.yml": "a", "menus/x.yml": "kept" },
      at: 1,
    });
    await writeDraftFile("srv.noel", "palette.yml", "a");
    expect(ensurePersistedDraft).not.toHaveBeenCalled();
    await writeDraftFile("srv.noel", "palette.yml", null);
    expect(useProjectDraftStore.getState().get("srv.noel")!.tree).toEqual({
      "menus/x.yml": "kept",
    });
    expect(ensurePersistedDraft).toHaveBeenCalledTimes(1);
  });

  it("refuses when the Project's published files are not known", async () => {
    await expect(writeDraftFile("srv.noel", "palette.yml", "a")).rejects.toThrow(
      "draft_unavailable",
    );
  });
});
