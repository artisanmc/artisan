import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { decodePng } from "@/lib/pack/png";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageNewDialog, kitStarts, sizeFor, startRecipe } from "./ImageNewDialog";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/lib/useAuthenticatedImage", () => ({
  useAuthenticatedImageUrl: (url: string) => url,
}));

const made = (name: string): Asset =>
  ({ id: name, projectId: "p1", type: "glyph", name, width: 54, height: 18 }) as Asset;
const choice = { rows: 6, area: { columns: 3, rows: 1 }, width: "32", height: "32" };

describe("a new image's size and start", () => {
  it("takes its size from what it is for", () => {
    expect(sizeFor("menu", choice)).toEqual({ width: 176, height: 222 });
    expect(sizeFor("menu", { ...choice, rows: 3 })).toEqual({ width: 176, height: 168 });
    expect(sizeFor("slots", choice)).toEqual({ width: 54, height: 18 });
    expect(sizeFor("slots", { ...choice, area: { columns: 3, rows: 2 } })).toEqual({
      width: 54,
      height: 36,
    });
    expect(sizeFor("icon", choice)).toEqual({ width: 16, height: 16 });
    expect(sizeFor("free", choice)).toEqual({ width: 32, height: 32 });
    expect(sizeFor("free", { ...choice, width: "0" })).toBeNull();
    expect(sizeFor("free", { ...choice, height: "999" })).toBeNull();
  });

  it("offers the kit pieces of that size", () => {
    expect(kitStarts("slots", choice)).toEqual([
      "button.3x1",
      "button.danger.3x1",
      "button.off.3x1",
      "button.plain.3x1",
      "panel.3x1",
      "value.3x1",
    ]);
    expect(kitStarts("slots", { ...choice, area: { columns: 3, rows: 2 } })).toEqual(["card.3x2"]);
    expect(kitStarts("slots", { ...choice, area: { columns: 5, rows: 4 } })).toEqual([]);
    expect(kitStarts("menu", choice)).toEqual(["window.6"]);
    expect(kitStarts("menu", { ...choice, rows: 4 })).toEqual([]);
    expect(kitStarts("icon", choice)).toEqual([]);
  });

  it("starts a window with its slots, and an image on slots at its fixed size", () => {
    expect(startRecipe("menu", "window.6", 6, { width: 176, height: 222 })).toEqual({
      layers: [
        { image: "kit:window.6", x: 0, y: 0, columns: 1, rows: 1 },
        { image: "kit:cell", x: 7, y: 17, columns: 9, rows: 6 },
      ],
      width: null,
      height: null,
    });
    expect(startRecipe("slots", "button.3x1", 6, { width: 54, height: 18 })).toEqual({
      layers: [{ image: "kit:button.3x1", x: 0, y: 0, columns: 1, rows: 1 }],
      width: 54,
      height: 18,
    });
  });
});

describe("ImageNewDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts an image on 3 × 1 slots from the kit's button, as a composed image", async () => {
    const composed = vi
      .spyOn(userAssetsApi, "composeAsset")
      .mockImplementation(async (_p, input) => made(input.name));
    const onCreated = vi.fn();
    render(
      <ImageNewDialog projectId={"p1" as never} open onClose={() => {}} onCreated={onCreated} />,
    );
    expect(screen.getByTestId("image-new-size")).toHaveTextContent("3 × 1 slots · 54 × 18 px");
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "join" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'atelier" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(composed.mock.calls[0]?.[1]).toMatchObject({
      name: "join",
      usages: ["button"],
      recipe: { layers: [{ image: "kit:button.3x1" }], width: 54, height: 18 },
    });
  });

  it("draws an empty image of the slots chosen on the grid", async () => {
    const uploaded = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_p, input) => made(input.name));
    const onCreated = vi.fn();
    render(
      <ImageNewDialog projectId={"p1" as never} open onClose={() => {}} onCreated={onCreated} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "5 × 2" }));
    expect(screen.getByTestId("image-new-size")).toHaveTextContent("5 × 2 slots · 90 × 36 px");
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "banner" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'atelier" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const file = uploaded.mock.calls[0]?.[1].file as File;
    const { width, height } = decodePng(new Uint8Array(await file.arrayBuffer()));
    expect([width, height]).toEqual([90, 36]);
  });

  it("makes a menu background a window of the rows chosen, drawn from the title's top", async () => {
    const uploaded = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_p, input) => made(input.name));
    render(
      <ImageNewDialog projectId={"p1" as never} open onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fond de menu" }));
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(screen.getByTestId("image-new-size")).toHaveTextContent("176 × 186 px");
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "hall" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'atelier" }));
    await waitFor(() => expect(uploaded).toHaveBeenCalled());
    expect(uploaded.mock.calls[0]?.[1]).toMatchObject({ usages: ["menu"], ascent: 13 });
  });
});
