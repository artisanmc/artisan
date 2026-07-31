import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-testid="konva-group" data-name={p.name}>{p.children}</div>,
  Rect: () => <div />, Image: () => <div />, Text: () => <div />, Line: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("@/features/canvas/title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));

import { SoloMenuStage } from "./SoloMenuStage";

const PID = "p1" as ProjectId;
beforeEach(() => {
  useAccountStore.setState({ account: { id: "a" as any, projectOrder: [PID], projects: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {},
  } as Project] } } as any);
});

describe("SoloMenuStage", () => {
  it("rend le menu demandé en mode solo", () => {
    render(<SoloMenuStage projectId={PID} menuId={"m1" as MenuId} />);
    const g = screen.getAllByTestId("konva-group").find((x) => x.getAttribute("data-name") === "menu:m1");
    expect(g).toBeDefined();
  });
  it("rend null si le menu n'existe pas", () => {
    const { container } = render(<SoloMenuStage projectId={PID} menuId={"zzz" as MenuId} />);
    expect(container.querySelector('[data-name="menu:m1"]')).toBeNull();
  });
});
