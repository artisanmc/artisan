import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGuides } from "./ImageGuides";
import { SlicePanel } from "./SlicePanel";
import { useAssetStore } from "./assetStore";

const button: Asset = {
  id: "button",
  projectId: "p1",
  type: "texture",
  name: "button",
  width: 20,
  height: 18,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
  previewUrl: "data:,",
} as Asset;

beforeEach(() => {
  vi.restoreAllMocks();
  useAssetStore.getState().setAssets([button]);
});

describe("SlicePanel", () => {
  it("writes a margin when its field is left, and shows the saved margins", async () => {
    const slice = { left: 4, right: 0, top: 0, bottom: 0 };
    const patch = vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue({ ...button, slice });
    render(<SlicePanel projectId={"p1" as never} asset={button} />);
    const left = screen.getByLabelText("Gauche");
    fireEvent.change(left, { target: { value: "4" } });
    fireEvent.blur(left);
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", "button", { slice }));
    await waitFor(() =>
      expect(useAssetStore.getState().assets.find((a) => a.id === "button")?.slice).toEqual(slice),
    );
  });

  it("takes the margins off when all are 0", async () => {
    const sliced = { ...button, slice: { left: 4, right: 4, top: 0, bottom: 0 } };
    const patch = vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue(button);
    render(<SlicePanel projectId={"p1" as never} asset={sliced} />);
    expect(screen.getByLabelText("Droite")).toHaveValue(4);
    fireEvent.change(screen.getByLabelText("Gauche"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Droite"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Droite"));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", "button", { slice: null }));
  });

  it("refuses margins that leave nothing to repeat, and writes nothing", () => {
    const patch = vi.spyOn(userAssetsApi, "patchAsset");
    render(<SlicePanel projectId={"p1" as never} asset={button} />);
    fireEvent.change(screen.getByLabelText("Gauche"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Droite"), { target: { value: "8" } });
    fireEvent.blur(screen.getByLabelText("Droite"));
    expect(screen.getByRole("alert")).toHaveTextContent("ne laissent rien à répéter");
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("ImageGuides", () => {
  it("draws a line at each margin of a sliced image, shown guides or not", () => {
    render(
      <ImageGuides
        width={20}
        height={18}
        scale={10}
        shown={[]}
        slice={{ left: 4, right: 3, top: 0, bottom: 5 }}
      />,
    );
    const lines = screen.getAllByTestId("guide-slice");
    expect(lines.map((line) => line.style.left || line.style.top)).toEqual([
      "40px",
      "170px",
      "130px",
    ]);
  });
});
