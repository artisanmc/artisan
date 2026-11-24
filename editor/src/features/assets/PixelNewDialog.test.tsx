import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { decodePng } from "@/lib/pack/png";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PixelNewDialog } from "./PixelNewDialog";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));

const made = (name: string): Asset => ({
  id: name,
  projectId: "p1",
  type: "glyph",
  name,
  width: 16,
  height: 16,
  ascent: 8,
  codepoint: 57344,
  fontMeta: null,
  contentHash: name,
  createdAt: "",
  updatedAt: "",
});
const bytesOf = (file: File) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });

describe("PixelNewDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAssetStore.getState().reset();
  });

  it("creates an empty image of the chosen size, to be drawn", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_project, input) => made(input.name));
    const onCreated = vi.fn();
    render(
      <PixelNewDialog projectId={"p1" as never} open onClose={vi.fn()} onCreated={onCreated} />,
    );
    const create = screen.getByRole("button", { name: "Créer" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "coin" } });
    // A size of one's own, within what the editor draws.
    fireEvent.click(screen.getByRole("button", { name: "Autre" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Largeur" }), {
      target: { value: "300" },
    });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Largeur" }), {
      target: { value: "24" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Hauteur" }), {
      target: { value: "12" },
    });
    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made("coin")));
    const [project, input] = upload.mock.calls[0]!;
    expect(project).toBe("p1");
    expect(input).toMatchObject({ type: "glyph", name: "coin", usages: ["button"] });
    const image = decodePng(await bytesOf(input.file));
    expect([image.width, image.height]).toEqual([24, 12]);
    expect(image.data.every((value) => value === 0)).toBe(true);
    expect(useAssetStore.getState().assets.map((a) => a.id)).toEqual(["coin"]);
  });

  it("offers the sizes of an icon, a slot and a button", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_project, input) => made(input.name));
    render(<PixelNewDialog projectId={"p1" as never} open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "join" } });
    fireEvent.click(screen.getByRole("button", { name: "Bouton 54 × 18" }));
    fireEvent.click(screen.getByRole("button", { name: "Créer" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const image = decodePng(await bytesOf(upload.mock.calls[0]![1].file));
    expect([image.width, image.height]).toEqual([54, 18]);
  });
});
