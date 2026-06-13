import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1" }),
  useNavigate: () => navigate,
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
}));

import { WorkspacePanel } from "./WorkspacePanel";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("WorkspacePanel", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({
      account: { id: "a" as any, packs: [pack()], packOrder: [PID] },
    } as any);
  });

  it("liste les éléments par catégorie avec le badge on-board", () => {
    render(<WorkspacePanel packId={PID} />);
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
    expect(screen.getAllByText(/on board|sur la planche/i).length).toBeGreaterThanOrEqual(1);
  });

  it("la recherche filtre la liste", () => {
    render(<WorkspacePanel packId={PID} />);
    fireEvent.change(screen.getByPlaceholderText(/search|rechercher/i), {
      target: { value: "heal" },
    });
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.queryByText("m1")).not.toBeInTheDocument();
  });

  it("cliquer un élément navigue vers sa vue individuelle", () => {
    render(<WorkspacePanel packId={PID} />);
    fireEvent.click(screen.getByText("/heal"));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
        params: expect.objectContaining({ elementId: "c1" }),
      }),
    );
  });
});
