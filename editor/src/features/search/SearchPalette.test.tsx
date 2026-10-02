import type { Project, ProjectId } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", projectId: "p1" }),
}));

import { SearchPalette } from "./SearchPalette";

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: "m_shop",
        projectId: PID,
        title: [{ kind: "plain", value: { key: "k" } }],
        rows: 3,
        layers: [
          {
            id: "L",
            name: "d",
            elements: [
              { id: "el_buy", positions: "13", display: { material: "DIAMOND" }, states: [] },
            ],
          },
        ],
      } as any,
    ],
    commands: [{ id: "c_heal", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { k: { en: "Shop" } } as any,
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}

describe("SearchPalette", () => {
  beforeEach(() => {
    navigate.mockClear();
    useServerIndexStore.getState().reset();
    useAccountStore.setState({
      account: { id: "a" as any, projects: [project()], projectOrder: [PID] },
    } as any);
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
  it("Entrée sur un menu centre la planche dessus et le sélectionne", () => {
    render(<SearchPalette projectId={PID} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "shop" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/networks/$networkId/servers/$serverId/projects/$projectId" }),
    );
    expect(useUiStore.getState().centerRequest).toMatchObject({ docId: "m_shop" });
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

  describe("autres projects du serveur", () => {
    const boutique = (): Project =>
      ({
        id: "boutique" as ProjectId,
        diskId: "boutique",
        name: "Boutique",
        menus: [
          {
            id: "catalogue",
            projectId: "boutique",
            title: [{ kind: "plain", value: { key: "kc" } }],
            rows: 3,
            layers: [],
          },
        ],
        commands: [],
        dialogs: [],
        i18nKeys: { kc: { en: "Catalogue" } },
        defaultLang: "en",
      }) as unknown as Project;

    beforeEach(() => {
      useServerIndexStore.setState({
        scope: "n1/s1",
        status: "ready",
        projects: [boutique()],
        failed: [],
      });
    });

    it("propose leurs Documents, avec le project en contexte, et y navigue", () => {
      render(<SearchPalette projectId={PID} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "catalogue" } });
      expect(screen.getByText("Catalogue")).toBeInTheDocument();
      expect(screen.getByText("dans Boutique")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/networks/$networkId/servers/$serverId/projects/$projectId",
          params: expect.objectContaining({ projectId: "boutique" }),
          search: { doc: "catalogue" },
        }),
      );
    });

    it("ne répète pas le project en cours d'édition, déjà indexé en détail", () => {
      useServerIndexStore.setState({ projects: [boutique(), project()] });
      render(<SearchPalette projectId={PID} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "heal" } });
      expect(screen.getAllByText("/heal")).toHaveLength(1);
    });

    it("ignore ce qui a été chargé pour un autre serveur", () => {
      useServerIndexStore.setState({ scope: "n1/ailleurs" });
      render(<SearchPalette projectId={PID} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "catalogue" } });
      expect(screen.queryByText("Catalogue")).not.toBeInTheDocument();
    });

    it("garde les résultats du project édité avant ceux des autres", () => {
      useServerIndexStore.setState({
        projects: [{ ...boutique(), commands: [{ id: "c", projectId: "boutique", name: "heal2", arguments: [], steps: [] }] } as unknown as Project],
      });
      render(<SearchPalette projectId={PID} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "heal" } });
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      expect(options[0]).toContain("/heal");
      expect(options[1]).toContain("/heal2");
    });
  });
});
