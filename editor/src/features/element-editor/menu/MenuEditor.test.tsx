import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MenuEditor } from "./MenuEditor";

vi.mock("./SingleMenuStage", () => ({ SingleMenuStage: () => <div>MENU_STAGE_STUB</div> }));
vi.mock("@/features/canvas/title/composer/LayersPanel", () => ({ LayersPanel: () => <div>LAYERS_PANEL_STUB</div> }));
vi.mock("@/features/canvas/properties/MenuProperties", () => ({ MenuProperties: () => <div>MENU_PROPERTIES_STUB</div> }));
vi.mock("./LibraryDrawer", () => ({ LibraryDrawer: () => null }));
vi.mock("./AssetsDrawer", () => ({ AssetsDrawer: () => null }));
vi.mock("@/features/canvas/Library", () => ({ Library: () => <div>LIBRARY_STUB</div> }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>ASSETS_TAB_STUB</div> }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: vi.fn(() => true) }));

import { useIsDesktop } from "@/lib/useMediaQuery";

const pack = { id: "p1", menus: [], commands: [], dialogs: [], assets: [], defaultLang: "en", i18nKeys: {} } as any;
const menu = { id: "m1", name: "Menu 1", rows: 3, layers: [], title: [] } as any;

describe("MenuEditor", () => {
  it("renders SingleMenuStage, MenuProperties, and LayersPanel in a 3-column layout", () => {
    vi.mocked(useIsDesktop).mockReturnValue(true);
    render(<MenuEditor pack={pack} menu={menu} />);
    expect(screen.getByText("MENU_STAGE_STUB")).toBeInTheDocument();
    expect(screen.getByText("MENU_PROPERTIES_STUB")).toBeInTheDocument();
    expect(screen.getByText("LAYERS_PANEL_STUB")).toBeInTheDocument();
  });

  it("renders tabs instead of 3-col when not desktop", () => {
    vi.mocked(useIsDesktop).mockReturnValue(false);
    render(<MenuEditor pack={pack} menu={menu} />);
    // WorkspaceTabs renders buttons with role="tab" for each tab.
    // i18next in tests resolves keys, so labels may be in any configured locale —
    // we assert by checking the tablist has 5 tabs and the canvas one is active.
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    // First tab (Canvas) is active by default
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    // Canvas stage is rendered in the active tab
    expect(screen.getByText("MENU_STAGE_STUB")).toBeInTheDocument();
    // Properties and Layers panels are not rendered until their tabs are active
    expect(screen.queryByText("MENU_PROPERTIES_STUB")).not.toBeInTheDocument();
    expect(screen.queryByText("LAYERS_PANEL_STUB")).not.toBeInTheDocument();
  });
});
