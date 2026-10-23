import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConditionListEditor } from "./ConditionListEditor";

const openMenu = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
};

describe("ConditionListEditor", () => {
  it("adds the first condition straight from the empty zone, without an AND chip", async () => {
    const onChange = vi.fn();
    render(
      <ConditionListEditor label="" conditions={[]} onChange={onChange} emptyHint="(always)" />,
    );
    expect(screen.queryByText("+ AND")).not.toBeInTheDocument();
    openMenu(screen.getByRole("button", { name: /\(always\)/ }));
    fireEvent.click(await screen.findByText("has permission"));
    expect(onChange).toHaveBeenCalledWith([{ type: "has_permission", perm: "" }]);
  });

  it("keeps the AND chip for the following conditions", () => {
    render(
      <ConditionListEditor
        label=""
        conditions={[{ type: "has_permission", perm: "a" }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("+ AND")).toBeInTheDocument();
  });
});
