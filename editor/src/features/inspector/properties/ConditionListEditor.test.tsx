import { useServerVariablesStore } from "@/state/serverVariablesStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConditionListEditor } from "./ConditionListEditor";

const HAS_GUILD = {
  name: "guilds.has_guild",
  type: "boolean" as const,
  scope: "player" as const,
  values: [],
  key: null,
  description: { en: "In a guild" },
  moduleId: "guilds",
};

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

  describe("module variables", () => {
    afterEach(() => useServerVariablesStore.setState({ variables: [], status: "idle" } as never));

    it("adds a criterion on the first variable the server declares", async () => {
      useServerVariablesStore.setState({ variables: [HAS_GUILD], status: "ready" } as never);
      const onChange = vi.fn();
      render(
        <ConditionListEditor label="" conditions={[]} onChange={onChange} emptyHint="(always)" />,
      );
      openMenu(screen.getByRole("button", { name: /\(always\)/ }));
      fireEvent.click(await screen.findByText("variable"));
      expect(onChange).toHaveBeenCalledWith([{ type: "expression", expr: "var.guilds.has_guild" }]);
    });

    it("shows an expression reading a variable as a criterion, and switches it to false", async () => {
      useServerVariablesStore.setState({ variables: [HAS_GUILD], status: "ready" } as never);
      const onChange = vi.fn();
      render(
        <ConditionListEditor
          label=""
          conditions={[{ type: "expression", expr: "var.guilds.has_guild" }]}
          onChange={onChange}
        />,
      );
      expect(screen.getByText("var")).toBeInTheDocument();
      openMenu(screen.getByRole("button", { name: /^(is true|est vrai)$/ }));
      fireEvent.click(await screen.findByText(/^(is false|est faux)$/));
      expect(onChange).toHaveBeenCalledWith([
        { type: "expression", expr: "!var.guilds.has_guild" },
      ]);
    });

    it("flags a variable no installed module declares", () => {
      useServerVariablesStore.setState({ variables: [], status: "ready" } as never);
      render(
        <ConditionListEditor
          label=""
          conditions={[{ type: "expression", expr: "var.lands.claims > 0" }]}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText("lands.claims")).toHaveClass("line-through");
    });
  });
});
