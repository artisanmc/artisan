import type { Asset } from "@/domain/asset";
import { useAssetStore } from "@/features/assets/assetStore";
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ImageButtonDragPreview, ImageButtonLibrary } from "./ImageButtonLibrary";

vi.mock("@/features/assets/AssetPreview", () => ({
  AssetPreview: ({ asset }: { asset: Asset }) => <img alt={asset.name} />,
}));
vi.mock("@/features/assets/AssetUploadDialog", () => ({
  AssetUploadDialog: ({ open }: { open: boolean }) =>
    open ? <div>Upload image dialog</div> : null,
}));

it("previews native image pixels at canvas zoom instead of a fixed square thumbnail", () => {
  const asset = { id: "wide", name: "Wide", width: 48, height: 16 } as Asset;
  const { rerender } = render(<ImageButtonDragPreview asset={asset} scale={1} />);
  expect(screen.getByTestId("image-button-drag-preview")).toHaveStyle({
    width: "96px",
    height: "32px",
  });
  rerender(<ImageButtonDragPreview asset={asset} scale={2.5} />);
  expect(screen.getByTestId("image-button-drag-preview")).toHaveStyle({
    width: "240px",
    height: "80px",
  });
  rerender(<ImageButtonDragPreview asset={{ ...asset, width: 7, height: 25 }} scale={0.5} />);
  expect(screen.getByTestId("image-button-drag-preview")).toHaveStyle({
    width: "7px",
    height: "25px",
  });
});

it("lists project images with their slot footprint, filters them and offers upload", () => {
  useAssetStore.setState({
    assets: [
      {
        id: "tall",
        name: "Tall",
        projectId: "p",
        type: "glyph",
        width: 16,
        height: 48,
        usages: ["button"],
      },
      {
        id: "wide",
        name: "Wide",
        projectId: "p",
        type: "texture",
        width: 48,
        height: 16,
        usages: ["button"],
      },
      {
        id: "background",
        name: "Background",
        projectId: "p",
        type: "glyph",
        width: 176,
        height: 166,
        usages: ["background"],
      },
      { id: "foreign", name: "Foreign", projectId: "other", type: "glyph", width: 16, height: 16 },
      { id: "font", name: "Font", projectId: "p", type: "font", width: 16, height: 16 },
    ] as Asset[],
  });
  render(
    <DndContext>
      <ImageButtonLibrary projectId={"p" as never} />
    </DndContext>,
  );
  expect(screen.getByText("1 × 3 slots")).toBeInTheDocument();
  expect(screen.getByText("3 × 1 slots")).toBeInTheDocument();
  expect(screen.queryByText("Foreign")).not.toBeInTheDocument();
  expect(screen.queryByText("Font")).not.toBeInTheDocument();
  expect(screen.queryByText("Background")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "tall" } });
  expect(screen.queryByText("Wide")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Importer/ }));
  expect(screen.getByText("Upload image dialog")).toBeInTheDocument();
});
