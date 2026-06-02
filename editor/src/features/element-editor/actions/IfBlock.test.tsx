import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IfBlock } from "./IfBlock";

// IfBlock recursively renders ActionsChainEditor for case bodies — stub it.
vi.mock("./ActionsChainEditor", () => ({
  ActionsChainEditor: () => <div>CHAIN_STUB</div>,
}));

const ifStep = {
  kind: "if",
  cases: [
    {
      conditions: [{ type: "expression", expr: "player.balance >= 100" }],
      steps: [],
    },
  ],
  else: [],
} as any;

describe("IfBlock", () => {
  it("renders the condition header and a nested chain for the case body", () => {
    render(<IfBlock step={ifStep} packMenus={[]} onChange={() => {}} />);
    // Should display something about the condition (type or expr)
    expect(screen.getByText(/player\.balance >= 100/)).toBeInTheDocument();
    expect(screen.getAllByText("CHAIN_STUB").length).toBeGreaterThan(0);
  });

  it("renders an ELSE row when `else` is present", () => {
    render(<IfBlock step={ifStep} packMenus={[]} onChange={() => {}} />);
    expect(screen.getByText(/ELSE/)).toBeInTheDocument();
  });
});
