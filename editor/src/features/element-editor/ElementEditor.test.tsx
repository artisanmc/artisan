import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ElementEditor } from "./ElementEditor";

vi.mock("./menu/MenuEditor", () => ({ MenuEditor: () => <div>MENU_EDITOR_STUB</div> }));
vi.mock("./command/CommandEditor", () => ({ CommandEditor: () => <div>COMMAND_EDITOR_STUB</div> }));
vi.mock("./dialog/DialogEditor", () => ({ DialogEditor: () => <div>DIALOG_EDITOR_STUB</div> }));
vi.mock("./UnknownElementFallback", () => ({
  UnknownElementFallback: () => <div>This element no longer exists.</div>,
}));

const pack = {
  id: "p1",
  menus: [{ id: "m1", name: "Menu 1" }],
  commands: [{ id: "c1", trigger: "/cmd" }],
  dialogs: [{ id: "d1", title: { key: "t" } }],
} as any;

describe("ElementEditor", () => {
  it("dispatches to MenuEditor when elementId matches a menu", () => {
    render(<ElementEditor pack={pack} elementId={"m1" as any} />);
    expect(screen.getByText("MENU_EDITOR_STUB")).toBeInTheDocument();
  });
  it("dispatches to CommandEditor when elementId matches a command", () => {
    render(<ElementEditor pack={pack} elementId={"c1" as any} />);
    expect(screen.getByText("COMMAND_EDITOR_STUB")).toBeInTheDocument();
  });
  it("dispatches to DialogEditor when elementId matches a dialog", () => {
    render(<ElementEditor pack={pack} elementId={"d1" as any} />);
    expect(screen.getByText("DIALOG_EDITOR_STUB")).toBeInTheDocument();
  });
  it("renders UnknownElementFallback when elementId matches nothing", () => {
    render(<ElementEditor pack={pack} elementId={"zzz" as any} />);
    expect(screen.getByText(/n'existe plus|no longer exists/i)).toBeInTheDocument();
  });
});
