import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConditionsField } from "./ConditionsField";

const openMenu = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
};

describe("ConditionsField", () => {
  it("edits a keyed list and writes it back in keyed wire", async () => {
    const onChange = vi.fn();
    render(
      <ConditionsField
        value={[{ has_permission: "vip" }, { not: { world_is: "nether" } }]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("vip")).toBeInTheDocument();
    openMenu(screen.getByText("+ AND"));
    fireEvent.click(await screen.findByText("has money"));
    expect(onChange).toHaveBeenCalledWith([
      { has_permission: "vip" },
      { not: { world_is: "nether" } },
      { has_money: 0 },
    ]);
  });

  it("keeps what it cannot decode, after the edited conditions", async () => {
    const onChange = vi.fn();
    const moduleCondition = { "quests:active": "forge" };
    const typeTagged = { type: "has_permission", perm: "a" };
    render(
      <ConditionsField
        value={[moduleCondition, { has_permission: "vip" }, { and: [{ "x:y": 1 }] }, typeTagged]}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/3 conditions/)).toBeInTheDocument();
    openMenu(screen.getByText("+ AND"));
    fireEvent.click(await screen.findByText("has money"));
    expect(onChange).toHaveBeenCalledWith([
      { has_permission: "vip" },
      { has_money: 0 },
      moduleCondition,
      { and: [{ "x:y": 1 }] },
      typeTagged,
    ]);
  });

  it("reads a single condition as a list of one", () => {
    render(<ConditionsField value={{ has_permission: "solo" }} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("solo")).toBeInTheDocument();
  });
});
