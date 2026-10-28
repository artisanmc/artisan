import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AliasesField } from "./AliasesField";

describe("AliasesField", () => {
  it("renders existing aliases as chips", () => {
    render(<AliasesField label="aliases" aliases={["h", "heal"]} onChange={vi.fn()} />);
    expect(screen.getByText("h")).toBeInTheDocument();
    expect(screen.getByText("heal")).toBeInTheDocument();
  });

  it("calls onChange with alias removed when × clicked", () => {
    const onChange = vi.fn();
    render(<AliasesField label="aliases" aliases={["h", "heal"]} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(["heal"]);
  });

  it("adds an alias on Enter", () => {
    const onChange = vi.fn();
    render(<AliasesField label="aliases" aliases={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "shop" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["shop"]);
  });

  it("ignores duplicate aliases", () => {
    const onChange = vi.fn();
    render(<AliasesField label="aliases" aliases={["h"]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "h" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("normalizes alias to lowercase with no spaces", () => {
    const onChange = vi.fn();
    render(<AliasesField label="aliases" aliases={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "My Alias" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["my_alias"]);
  });
});
