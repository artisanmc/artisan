import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { Stage } from "./Stage";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage" data-draggable={String(!!p.draggable)}>{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-name={p.name}>{p.children}</div>,
  Rect: () => <div />, Image: () => <div />, Text: () => <div />, Line: () => <div />,
  Transformer: () => <div />, Arrow: () => <div />, Circle: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));
vi.mock("./Edges", () => ({ Edges: () => <div /> }));

const PID = "p1" as PackId;
function pack(): Pack {
  return { id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [], commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {} } as Pack;
}
describe("Stage — modes", () => {
  beforeEach(() => useAccountStore.setState({ account: { id: "a" as any, packs: [pack()], packOrder: [PID] } } as any));
  it("hand mode → stage draggable", () => {
    useUiStore.setState({ canvasMode: "hand" } as any);
    render(<Stage packId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("true");
  });
  it("select mode → stage NOT draggable", () => {
    useUiStore.setState({ canvasMode: "select" } as any);
    render(<Stage packId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("false");
  });
});
