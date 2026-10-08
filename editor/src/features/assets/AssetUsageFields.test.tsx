import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetUsageFields } from "./AssetUsageFields";

describe("AssetUsageFields", () => {
  it("offers only the menu uses — container textures are a server setting", () => {
    const onChange = vi.fn();
    render(<AssetUsageFields value={["menu"]} onChange={onChange} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "Texture de coffre" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Images de boutons" }));
    expect(onChange).toHaveBeenCalledWith(["button", "menu"]);
  });

  it("drops legacy container texture uses", () => {
    const asset = { type: "texture", usages: ["chest_texture", "menu"] } as unknown as Asset;
    expect(assetUsages(asset)).toEqual(["menu"]);
  });
});
