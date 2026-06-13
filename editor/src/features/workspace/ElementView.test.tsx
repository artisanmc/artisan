import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1", elementId: "m1" }),
}));
vi.mock("./SoloMenuStage", () => ({ SoloMenuStage: () => <div data-testid="solo-menu" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => <div data-testid="editor-pane" /> }));

import { ElementView } from "./ElementView";

const PID = "p1" as PackId;
beforeEach(() => {
  navigate.mockClear();
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {},
  } as Pack] } } as any);
});

describe("ElementView", () => {
  it("rend SoloMenuStage + EditorPane pour un menu", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect(screen.getByTestId("solo-menu")).toBeInTheDocument();
    expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
  });
  it("le bouton retour navigue vers l'overview", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    fireEvent.click(screen.getByText(/back to board|retour à la planche/i));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    }));
  });
  it("élément introuvable → notFound", () => {
    render(<ElementView packId={PID} elementId={"zzz" as any} />);
    expect(screen.getByText(/no longer exists|n'existe plus/i)).toBeInTheDocument();
  });
});
