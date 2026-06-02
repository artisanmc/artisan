import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MenuEditor } from "./MenuEditor";

vi.mock("./SingleMenuStage", () => ({ SingleMenuStage: () => <div>MENU_STAGE_STUB</div> }));
vi.mock("@/features/canvas/title/composer/LayersPanel", () => ({ LayersPanel: () => <div>LAYERS_PANEL_STUB</div> }));
vi.mock("@/features/canvas/properties/MenuProperties", () => ({ MenuProperties: () => <div>MENU_PROPERTIES_STUB</div> }));

const pack = { id: "p1", menus: [], commands: [], dialogs: [], assets: [], defaultLang: "en", i18nKeys: {} } as any;
const menu = { id: "m1", name: "Menu 1", rows: 3, layers: [], title: [] } as any;

describe("MenuEditor", () => {
  it("renders SingleMenuStage, MenuProperties, and LayersPanel in a 3-column layout", () => {
    render(<MenuEditor pack={pack} menu={menu} />);
    expect(screen.getByText("MENU_STAGE_STUB")).toBeInTheDocument();
    expect(screen.getByText("MENU_PROPERTIES_STUB")).toBeInTheDocument();
    expect(screen.getByText("LAYERS_PANEL_STUB")).toBeInTheDocument();
  });
});
