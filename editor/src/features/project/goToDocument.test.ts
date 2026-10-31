import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateProjectSearch } from "./ProjectCanvasPage";
import { goToDocument } from "./goToDocument";

const navigate = vi.fn();
const core = { id: "p1", diskId: "core" };
const BOARD = "/servers/$serverId/projects/$projectId";

beforeEach(() => {
  navigate.mockReset();
  useUiStore.setState({ centerRequest: null });
  useSelectionStore.getState().clear();
});

describe("goToDocument", () => {
  it("selects the document, asks the board to centre on it, and returns to the board", () => {
    goToDocument(navigate, { serverId: "s", project: core, ref: "menu/main" });
    expect(useUiStore.getState().centerRequest).toMatchObject({
      projectId: "p1",
      docId: "menu/main",
    });
    expect([...useSelectionStore.getState().ids]).toEqual(["menu/main"]);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: BOARD,
        params: expect.objectContaining({ projectId: "core" }),
        search: { tab: "board" },
      }),
    );
  });

  it("centres again when the same document is picked twice", () => {
    goToDocument(navigate, { serverId: "s", project: core, ref: "main", kind: "menu" });
    const first = useUiStore.getState().centerRequest?.nonce;
    goToDocument(navigate, { serverId: "s", project: core, ref: "main", kind: "menu" });
    expect(useUiStore.getState().centerRequest?.nonce).not.toBe(first);
  });

  it("opens another project on its board, centred on the document, through the URL", () => {
    goToDocument(navigate, { serverId: "s", project: core, ref: "boutique:main" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: BOARD,
        params: expect.objectContaining({ projectId: "boutique" }),
        search: { doc: "main" },
      }),
    );
    expect(useUiStore.getState().centerRequest).toBeNull();
  });

  it("treats a ref qualified with this project's own folder as local", () => {
    goToDocument(navigate, { serverId: "s", project: core, ref: "menu/core:main" });
    expect(useUiStore.getState().centerRequest).toMatchObject({ docId: "menu/main" });
  });
});

describe("validateProjectSearch", () => {
  it("opens another project's Document of a known kind by its key", () => {
    goToDocument(navigate, { serverId: "s", project: core, ref: "boutique:main", kind: "menu" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { doc: "menu/main" } }),
    );
  });

  it("keeps the document to centre on, from a deep link", () => {
    expect(validateProjectSearch({ doc: "main" })).toEqual({ tab: "board", doc: "main" });
  });

  it("drops a malformed doc", () => {
    expect(validateProjectSearch({ doc: 3 })).toEqual({});
    expect(validateProjectSearch({ tab: "translations" })).toEqual({ tab: "translations" });
  });

  it("opens the module's home by default, the board on `board` and on the old `overview`", () => {
    expect(validateProjectSearch({})).toEqual({});
    expect(validateProjectSearch({ tab: "board" })).toEqual({ tab: "board" });
    expect(validateProjectSearch({ tab: "overview" })).toEqual({ tab: "board" });
    expect(validateProjectSearch({ tab: "data-sources" })).toEqual({});
  });
});
