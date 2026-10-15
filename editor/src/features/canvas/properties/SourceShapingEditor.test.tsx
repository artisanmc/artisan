import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceShapingEditor } from "./SourceShapingEditor";
import type { ContextInput, SourceRef } from "@/domain/types";

type SR = Extract<ContextInput, { kind: "sourceRef" }>;
const base: SR = {
  kind: "sourceRef",
  name: "quests",
  ref: "quests:list" as SourceRef,
  filter: { group: "{group}" },
  sort: { by: "order", direction: "asc" },
  limit: 27,
};

describe("SourceShapingEditor", () => {
  it("renders imported filter/sort/limit values (YAML round-trip becomes editable)", () => {
    render(
      <SourceShapingEditor
        input={base}
        schemaFields={["group", "order"]}
        argNames={["group"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("group")).toBeInTheDocument();
    expect(screen.getByDisplayValue("{group}")).toBeInTheDocument();
    expect(screen.getByDisplayValue("order")).toBeInTheDocument();
    expect(screen.getByDisplayValue("27")).toBeInTheDocument();
  });

  it("editing a filter value emits the rebuilt filter record", () => {
    const onChange = vi.fn();
    render(
      <SourceShapingEditor input={base} schemaFields={[]} argNames={[]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByDisplayValue("{group}"), { target: { value: "daily" } });
    expect(onChange).toHaveBeenCalledWith({ filter: { group: "daily" } });
  });

  it("adding a filter row then naming it emits a new entry", () => {
    const onChange = vi.fn();
    render(
      <SourceShapingEditor
        input={{ ...base, filter: undefined }}
        schemaFields={["cat"]}
        argNames={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("filter-add"));
    const fields = screen.getAllByTestId("filter-field");
    fireEvent.change(fields[fields.length - 1]!, { target: { value: "cat" } });
    const values = screen.getAllByTestId("filter-value");
    fireEvent.change(values[values.length - 1]!, { target: { value: "armes" } });
    expect(onChange).toHaveBeenLastCalledWith({ filter: { cat: "armes" } });
  });

  it("clearing limit emits undefined; setting sort none emits undefined", () => {
    const onChange = vi.fn();
    render(
      <SourceShapingEditor input={base} schemaFields={[]} argNames={[]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("limit-input"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ limit: undefined });
    fireEvent.change(screen.getByTestId("sort-by"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ sort: undefined });
  });

  it("reflects an external filter change (e.g. undo/redo) and re-emits the new values, not stale ones", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SourceShapingEditor
        input={base}
        schemaFields={["group", "order"]}
        argNames={["group"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("{group}")).toBeInTheDocument();

    // Simulate an external change to input.filter with the same ref/name
    // (undo/redo, or a version-guard revert) — the displayed rows must
    // reflect the new filter immediately.
    const externallyChanged: SR = { ...base, filter: { group: "weekly" } };
    rerender(
      <SourceShapingEditor
        input={externallyChanged}
        schemaFields={["group", "order"]}
        argNames={["group"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("weekly")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("{group}")).not.toBeInTheDocument();

    // Adding a row afterwards must emit the NEW external values merged
    // with the new row, not the stale pre-rerender values.
    fireEvent.click(screen.getByTestId("filter-add"));
    const fields = screen.getAllByTestId("filter-field");
    fireEvent.change(fields[fields.length - 1]!, { target: { value: "cat" } });
    const values = screen.getAllByTestId("filter-value");
    fireEvent.change(values[values.length - 1]!, { target: { value: "armes" } });
    expect(onChange).toHaveBeenLastCalledWith({ filter: { group: "weekly", cat: "armes" } });
  });

  it("offers schema fields and {arg} suggestions via datalists", () => {
    render(
      <SourceShapingEditor
        input={base}
        schemaFields={["group", "order"]}
        argNames={["group", "page"]}
        onChange={() => {}}
      />,
    );
    const fieldOptions = screen.getByTestId("filter-field-options").querySelectorAll("option");
    expect([...fieldOptions].map((o) => o.value)).toEqual(["group", "order"]);
    const valueOptions = screen.getByTestId("filter-value-options").querySelectorAll("option");
    expect([...valueOptions].map((o) => o.value)).toEqual(["{group}", "{page}"]);
  });
});
