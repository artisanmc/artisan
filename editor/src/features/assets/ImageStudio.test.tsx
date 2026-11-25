import type { Asset } from "@/domain/asset";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageStudio, useStudioPrefs } from "./ImageStudio";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/lib/useAuthenticatedImage", () => ({
  useAuthenticatedImageUrl: (url: string) => url,
}));

const composed = (name: string, width: number, height: number, image: string): Asset =>
  ({
    id: name,
    projectId: "p1",
    type: "glyph",
    name,
    width,
    height,
    ascent: 8,
    codepoint: null,
    fontMeta: null,
    contentHash: name,
    createdAt: "",
    updatedAt: "",
    previewUrl: "data:,",
    compose: { layers: [{ image, x: 0, y: 0, columns: 1, rows: 1 }], width, height },
  }) as Asset;

describe("ImageStudio", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    useStudioPrefs.setState({ hidden: [], situation: true });
  });

  it("shows a window with its slots, the player's inventory and the title, each turned off alone", () => {
    render(
      <ImageStudio
        projectId={"p1" as never}
        asset={composed("hall", 176, 222, "kit:window.6")}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText(/Fond de menu, 6 rangées · 176 × 222 px · 1 calque/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("guide-slots")).toBeInTheDocument();
    expect(screen.getAllByTestId("guide-inventory")).toHaveLength(2);
    expect(screen.getByTestId("guide-title")).toBeInTheDocument();
    // A window is the menu: it is not shown inside another.
    expect(screen.queryByTestId("situation-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inventaire du joueur" }));
    expect(screen.queryByTestId("guide-inventory")).toBeNull();
    expect(screen.getByTestId("guide-slots")).toBeInTheDocument();
  });

  it("shows an image on slots in a menu, and goes back to the library", () => {
    const onClose = vi.fn();
    render(
      <ImageStudio
        projectId={"p1" as never}
        asset={composed("join", 54, 18, "kit:button.3x1")}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Sur des slots, 3 × 1 · 54 × 18 px/)).toBeInTheDocument();
    expect(screen.getByTestId("situation-preview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Titre" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dans un menu" }));
    expect(screen.queryByTestId("situation-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ressources" }));
    expect(onClose).toHaveBeenCalled();
  });
});
