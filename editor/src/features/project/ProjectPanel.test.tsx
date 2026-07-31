import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ networkId: "n1", serverId: "s1", projectId: "p1" }),
  useNavigate: () => navigate,
}));

import { ProjectPanel } from "./ProjectPanel";

const PID = "p1" as ProjectId;
function pack(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Project;
}

const REMOVE = /remove from canvas|retirer du canvas/i;
const ADD = /add to canvas|ajouter au canvas/i;

describe("ProjectPanel", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({
      account: { id: "a" as any, projects: [pack()], projectOrder: [PID] },
    } as any);
  });

  it("liste les éléments par catégorie", () => {
    render(<ProjectPanel projectId={PID} />);
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
  });

  it("affiche le toggle 'retirer' pour un élément sur le canvas et 'ajouter' sinon", () => {
    render(<ProjectPanel projectId={PID} />);
    // m1 est dans canvasLayout → bouton retirer ; c1 ne l'est pas → bouton ajouter.
    expect(screen.getByTitle(REMOVE)).toBeInTheDocument();
    expect(screen.getByTitle(ADD)).toBeInTheDocument();
  });

  it("cliquer un élément navigue vers sa vue individuelle", () => {
    render(<ProjectPanel projectId={PID} />);
    fireEvent.click(screen.getByText("/heal"));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId",
        params: expect.objectContaining({ documentId: "c1" }),
      }),
    );
  });

  it("le toggle 'ajouter au canvas' ajoute l'élément à la planche", () => {
    render(<ProjectPanel projectId={PID} />);
    fireEvent.click(screen.getByTitle(ADD));
    const p = useAccountStore.getState().account.projects.find((x) => x.id === PID)!;
    expect("c1" in p.canvasLayout).toBe(true);
  });

  it("le toggle 'retirer du canvas' retire l'élément de la planche sans le supprimer du pack", () => {
    render(<ProjectPanel projectId={PID} />);
    fireEvent.click(screen.getByTitle(REMOVE));
    const p = useAccountStore.getState().account.projects.find((x) => x.id === PID)!;
    expect("m1" in p.canvasLayout).toBe(false);
    expect(p.menus.some((m) => m.id === "m1")).toBe(true);
  });
});
