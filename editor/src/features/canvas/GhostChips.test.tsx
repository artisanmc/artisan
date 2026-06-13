import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { GhostChips } from "./GhostChips";

vi.mock("react-konva", () => ({
  Group: (p: any) => (
    <div data-testid="konva-group" data-name={p.name} onClick={(e) => p.onClick?.({ ...e, cancelBubble: false })}>
      {p.children}
    </div>
  ),
  Rect: () => <div />,
  Text: () => <div />,
}));

// On contrôle les edges directement : m1 sur la planche → cible shop hors-planche.
vi.mock("./deriveEdges", () => ({
  deriveEdges: () => [{ id: "m1->shop", source: "m1", target: "shop", triggers: [] }],
}));

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [
      { id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any,
      { id: "shop", packId: PID, title: [], rows: 3, layers: [] } as any,
    ],
    commands: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("GhostChips", () => {
  beforeEach(() => {
    useAccountStore.setState({
      account: { id: "a" as any, packs: [pack()], packOrder: [PID] },
    } as any);
  });

  it("rend un chip pour une cible hors-planche depuis un nœud sur la planche", () => {
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips pack={pack()} layout={layout} packId={PID} />);
    expect(screen.getByTestId("konva-group").getAttribute("data-name")).toBe(
      "ghostchip:m1->shop",
    );
  });

  it("le clic sur le chip ajoute la cible à la planche", () => {
    const spy = vi.spyOn(useAccountStore.getState(), "addToBoard");
    const layout = { m1: { x: 0, y: 0 } };
    render(<GhostChips pack={pack()} layout={layout} packId={PID} />);
    fireEvent.click(screen.getByTestId("konva-group"));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ packId: PID, nodeId: "shop" }),
    );
  });
});
