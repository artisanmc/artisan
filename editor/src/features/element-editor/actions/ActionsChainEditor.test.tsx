import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionsChainEditor } from "./ActionsChainEditor";

vi.mock("./ActionBlock", () => ({
  ActionBlock: ({ action }: any) => <div>ACTION_{action.type}</div>,
}));
vi.mock("./IfBlock", () => ({ IfBlock: () => <div>IF_BLOCK</div> }));

const steps = [
  { kind: "action", action: { type: "open_menu" } },
  { kind: "if", cases: [{ conditions: [], steps: [] }] },
  { kind: "action", action: { type: "send_message" } },
] as any;

describe("ActionsChainEditor", () => {
  it("renders an ActionBlock for each action step and an IfBlock for each if step", () => {
    render(<ActionsChainEditor steps={steps} packMenus={[]} onChange={() => {}} />);
    expect(screen.getByText("ACTION_open_menu")).toBeInTheDocument();
    expect(screen.getByText("IF_BLOCK")).toBeInTheDocument();
    expect(screen.getByText("ACTION_send_message")).toBeInTheDocument();
  });

  it("renders an empty-state hint when steps is empty", () => {
    render(<ActionsChainEditor steps={[]} packMenus={[]} onChange={() => {}} />);
    expect(screen.getByText(/aucune action|no action/i)).toBeInTheDocument();
  });
});
