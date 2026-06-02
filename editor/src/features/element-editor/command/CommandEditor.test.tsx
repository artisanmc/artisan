import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandEditor } from "./CommandEditor";

vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: vi.fn(() => true) }));
vi.mock("./CommandMetaForm", () => ({ CommandMetaForm: () => <div>META</div> }));
vi.mock("../actions/ActionsChainEditor", () => ({
  ActionsChainEditor: () => <div>CHAIN</div>,
}));
vi.mock("../actions/AddActionButton", () => ({
  AddActionButton: () => <div>ADD</div>,
}));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) => sel({ updateCommand: vi.fn() }),
}));

const pack = {
  id: "p1",
  commands: [],
  menus: [],
  dialogs: [],
  i18nKeys: {},
  defaultLang: "en",
} as any;

const command = { id: "c1", packId: "p1", name: "/x", arguments: [], steps: [] } as any;

describe("CommandEditor", () => {
  it("renders Meta and Chain side-by-side on desktop", () => {
    render(<CommandEditor pack={pack} command={command} />);
    expect(screen.getByText("META")).toBeInTheDocument();
    expect(screen.getByText("CHAIN")).toBeInTheDocument();
    expect(screen.getByText("ADD")).toBeInTheDocument();
  });

  it("renders stacked layout on mobile", async () => {
    const mod = await import("@/lib/useMediaQuery") as any;
    mod.useIsDesktop.mockReturnValue(false);
    render(<CommandEditor pack={pack} command={command} />);
    expect(screen.getByText("META")).toBeInTheDocument();
    expect(screen.getByText("CHAIN")).toBeInTheDocument();
  });
});
