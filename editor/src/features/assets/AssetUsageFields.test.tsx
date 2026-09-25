import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetUsageFields } from "./AssetUsageFields";

describe("AssetUsageFields", () => {
  it("offers the chest texture use with its expected format", () => {
    const onChange = vi.fn();
    render(<AssetUsageFields value={["menu"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Texture de coffre" }));
    expect(onChange).toHaveBeenCalledWith(["menu", "chest_texture"]);
    expect(screen.queryByText(/generic_54\.png/)).toBeNull();
  });

  it("explains the expected format once chosen", () => {
    render(<AssetUsageFields value={["chest_texture"]} onChange={() => {}} />);
    expect(screen.getByText(/generic_54\.png/)).toBeInTheDocument();
  });
});
