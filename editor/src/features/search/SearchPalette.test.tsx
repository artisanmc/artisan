import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useSelectionStore } from "@/state/selectionStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", projectId: "p1" }),
}));

import { SearchPalette } from "./SearchPalette";

const PID = "p1" as ProjectId;
function pack(): Project {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m_shop", projectId: PID, title: [{ kind: "plain", value: { key: "k" } }], rows: 3,
      layers: [{ id: "L", name: "d", elements: [{ id: "el_buy", positions: "13", appearances: [{ material: "DIAMOND" }] }] }] } as any],
    commands: [{ id: "c_heal", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: { k: { en: "Shop" } } as any, defaultLang: "en", canvasLayout: {},
  } as Project;
}

describe("SearchPalette", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({ account: { id: "a" as any, projects: [pack()], projectOrder: [PID] } } as any);
    useUiStore.setState({ searchOpen: true, activeLang: "en" } as any);
    useSelectionStore.getState().clear();
  });

  it("ne rend rien si searchOpen = false", () => {
    useUiStore.setState({ searchOpen: false } as any);
    const { container } = render(<SearchPalette projectId={PID} />);
    expect(container.querySelector("input")).toBeNull();
  });
  it("taper filtre et affiche les résultats", () => {
    render(<SearchPalette projectId={PID} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "heal" } });
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.queryByText("Shop")).not.toBeInTheDocument();
  });
  it("Entrée sur un menu navigue vers sa vue individuelle", () => {
    render(<SearchPalette projectId={PID} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "shop" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId",
      params: expect.objectContaining({ documentId: "m_shop" }),
    }));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
  it("Entrée sur un item sélectionne l'élément + slot", () => {
    render(<SearchPalette projectId={PID} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "diamond" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect([...useSelectionStore.getState().ids]).toContain("el_buy");
    expect(useSelectionStore.getState().focusedSlot).toBe(13);
  });
  it("Esc ferme la palette", () => {
    render(<SearchPalette projectId={PID} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});
