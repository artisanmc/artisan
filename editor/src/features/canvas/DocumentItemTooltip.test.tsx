import { useDocumentItemHoverStore } from "@/state/documentItemHoverStore";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentItemTooltip } from "./DocumentItemTooltip";

afterEach(() => useDocumentItemHoverStore.getState().set(null));

describe("DocumentItemTooltip", () => {
  it("shows nothing until a row with a tooltip is hovered", () => {
    render(<DocumentItemTooltip />);
    expect(screen.queryByTestId("document-item-tooltip")).toBeNull();
  });

  it("shows the hovered row's title, text and lines, rendered", () => {
    render(<DocumentItemTooltip />);
    act(() =>
      useDocumentItemHoverStore
        .getState()
        .set({ title: "<gold>Mineur", text: "Creuse un peu", lines: ["Casser 10 pierres"] }, 5, 5),
    );
    const tip = screen.getByTestId("document-item-tooltip");
    expect(tip).toHaveTextContent("Mineur");
    expect(tip).not.toHaveTextContent("<gold>");
    expect(tip).toHaveTextContent("Creuse un peu");
    expect(tip).toHaveTextContent("Casser 10 pierres");
  });
});
