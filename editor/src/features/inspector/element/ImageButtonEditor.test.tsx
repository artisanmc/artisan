import { useAssetStore } from "@/features/assets/assetStore";
import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ImageButtonEditor } from "./ImageButtonEditor";

vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: ({
    open,
    onPick,
  }: { open: boolean; onPick: (asset: { id: string; name: string }) => void }) =>
    open ? (
      <button
        type="button"
        onClick={() => onPick({ id: "buy", name: "Buy", width: 16, height: 48 } as never)}
      >
        Choose Buy
      </button>
    ) : null,
}));

it("picks an image and changes the rectangle without editing another appearance", () => {
  const onImage = vi.fn();
  const onPositions = vi.fn();
  render(
    <ImageButtonEditor
      projectId={"p" as never}
      menu={{ rows: 3, inventoryType: "chest" } as never}
      element={{ positions: "10-11,19-20" } as never}
      image={{ asset: "buy", fit: "contain" }}
      onImage={onImage}
      onPositions={onPositions}
      onItem={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Largeur (slots)"), { target: { value: "3" } });
  expect(onPositions).toHaveBeenCalledWith("10-12,19-21");
  fireEvent.click(screen.getByRole("button", { name: "Choisir une image" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Buy" }));
  expect(onImage).toHaveBeenCalledWith({ asset: "buy", fit: "contain" });
});

it("converts an item with the image's natural footprint and edits pixel offsets", () => {
  const onImage = vi.fn();
  const props = {
    projectId: "p" as never,
    menu: { rows: 3, inventoryType: "chest" } as never,
    element: { positions: "1" } as never,
    onImage,
    onPositions: vi.fn(),
    onItem: vi.fn(),
  };
  const { rerender } = render(<ImageButtonEditor {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Image" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Buy" }));
  expect(onImage).toHaveBeenCalledWith({ asset: "buy", fit: "native" }, "1,10,19");
  rerender(<ImageButtonEditor {...props} image={{ asset: "buy", fit: "native", offset_x: 2 }} />);
  fireEvent.change(screen.getByLabelText("Décalage vertical (px)"), { target: { value: "-3" } });
  expect(onImage).toHaveBeenCalledWith({ asset: "buy", fit: "native", offset_x: 2, offset_y: -3 });
  fireEvent.click(screen.getByRole("button", { name: "Recentrer" }));
  expect(onImage).toHaveBeenCalledWith({ asset: "buy", fit: "native", offset_x: 0, offset_y: 0 });
});

const pickCommon = () => {
  const onImage = vi.fn();
  render(
    <ImageButtonEditor
      projectId={"p" as never}
      menu={{ rows: 3, inventoryType: "chest" } as never}
      element={{ positions: "1" } as never}
      onImage={onImage}
      onPositions={vi.fn()}
      onItem={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communes" }));
  // The base is there on any server; a window is no button's image.
  expect(screen.queryByTitle(/^window\.6/)).toBeNull();
  fireEvent.click(screen.getByTitle(/^button\.3x1 /));
  return onImage;
};

it("takes a common image by its name alone, at its natural footprint", () => {
  useKitStore.setState({ read: { projectId: "artisan", files: {}, binaries: [], byName: true } });
  useAssetStore.getState().reset();
  expect(pickCommon()).toHaveBeenCalledWith({ asset: "button.3x1", fit: "native" }, "1-3");
});

it("names the common image with artisan: when the module holds an image of that name", () => {
  useKitStore.setState({ read: { projectId: "artisan", files: {}, binaries: [], byName: true } });
  useAssetStore.getState().reset();
  useAssetStore
    .getState()
    .setAssets([
      { id: "button.3x1", projectId: "p", type: "texture", name: "button.3x1" } as never,
    ]);
  expect(pickCommon()).toHaveBeenCalledWith({ asset: "artisan:button.3x1", fit: "native" }, "1-3");
  useAssetStore.getState().reset();
});

it("keeps kit: on a server older than the common images", () => {
  useKitStore.setState({ read: undefined });
  expect(pickCommon()).toHaveBeenCalledWith({ asset: "kit:button.3x1", fit: "native" }, "1-3");
});
