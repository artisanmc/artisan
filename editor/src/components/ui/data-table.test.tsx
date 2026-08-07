import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";

// CodeMirror needs layout APIs jsdom lacks; the YAML text itself is what we assert on.
vi.mock("./yaml-code-editor", () => ({
  YamlCodeEditor: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
    <pre data-testid="yaml-viewer" data-readonly={String(Boolean(readOnly))}>
      {value}
    </pre>
  ),
}));

const NESTED_ROWS = [
  {
    id: "daily:mine_stone",
    name: "Carrier",
    stages: [{ key: "stage_1", objectives: [{ key: "obj_1", target: 64, progress: 34 }] }],
  },
];

describe("DataTable", () => {
  it("stays a plain table when no view labels are given", () => {
    render(<DataTable rows={NESTED_ROWS} />);

    expect(screen.queryByTestId("data-table-view-yaml")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("defaults to the table view when the toggle is offered", () => {
    render(<DataTable rows={NESTED_ROWS} tableLabel="Table" yamlLabel="YAML" />);

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByTestId("data-table-yaml")).toBeNull();
    expect(screen.getByTestId("data-table-view-table").getAttribute("aria-selected")).toBe("true");
  });

  it("renders nested rows as indented YAML once switched", () => {
    render(<DataTable rows={NESTED_ROWS} tableLabel="Table" yamlLabel="YAML" />);

    fireEvent.click(screen.getByTestId("data-table-view-yaml"));

    expect(screen.queryByRole("table")).toBeNull();
    const yaml = screen.getByTestId("yaml-viewer").textContent ?? "";
    // The tree that a table cell could only show as a one-line JSON blob.
    expect(yaml).toContain("- id: daily:mine_stone");
    expect(yaml).toContain("stages:");
    expect(yaml).toContain("objectives:");
    expect(yaml).toContain("target: 64");
  });

  it("never lets the viewer be edited", () => {
    render(<DataTable rows={NESTED_ROWS} tableLabel="Table" yamlLabel="YAML" />);
    fireEvent.click(screen.getByTestId("data-table-view-yaml"));

    expect(screen.getByTestId("yaml-viewer").getAttribute("data-readonly")).toBe("true");
  });

  it("keeps long strings on one line so they stay copyable", () => {
    const long = `<gradient:#FFD166:#2ecc71>${"very long reward label ".repeat(8)}</gradient>`;
    render(<DataTable rows={[{ lore: long }]} tableLabel="Table" yamlLabel="YAML" />);

    fireEvent.click(screen.getByTestId("data-table-view-yaml"));

    const lines = (screen.getByTestId("yaml-viewer").textContent ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(long);
  });

  it("shows the empty label instead of an empty toggle", () => {
    render(<DataTable rows={[]} emptyLabel="No rows." tableLabel="Table" yamlLabel="YAML" />);

    expect(screen.getByText("No rows.")).toBeTruthy();
    expect(screen.queryByTestId("data-table-view-yaml")).toBeNull();
  });

  it("keeps the truncated notice visible in both views", () => {
    render(
      <DataTable
        rows={NESTED_ROWS}
        truncated
        truncatedLabel="Truncated."
        tableLabel="Table"
        yamlLabel="YAML"
      />,
    );

    expect(screen.getByTestId("data-table-truncated").textContent).toBe("Truncated.");
    fireEvent.click(screen.getByTestId("data-table-view-yaml"));
    expect(screen.getByTestId("data-table-truncated").textContent).toBe("Truncated.");
  });
});
