import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { type RgbaImage, createImage, decodePng, encodePng } from "@/lib/pack/png";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PixelEditor } from "./PixelEditor";
import { SaveActions, type StudioTool } from "./StudioFrame";
import { useAssetStore } from "./assetStore";
import { type Rgba, paint, pixelAt, toHex } from "./pixelTools";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));

const RED: Rgba = [255, 0, 0, 255];
const GOLD: Rgba = [200, 160, 40, 255];

const asset = (name: string, extra: Partial<Asset> = {}): Asset => ({
  id: name,
  projectId: "p1",
  type: "glyph",
  name,
  width: 4,
  height: 4,
  ascent: 8,
  codepoint: 57344,
  fontMeta: null,
  contentHash: name,
  createdAt: "",
  updatedAt: "",
  ...extra,
});
const icon = asset("icon");

/** What the hub holds: the icon (a red top row on nothing), and one kit image, all gold. */
const files: Record<string, Uint8Array | undefined> = {};
vi.mock("./assetBytes", () => ({
  assetBytes: async (a: Asset) => {
    const bytes = files[a.id];
    if (!bytes) throw new Error("image_unavailable:404");
    return bytes;
  },
}));
vi.mock("./kitAssets", () => ({
  useKitAssets: () => KIT,
}));
const KIT = [asset("kit:cell", { projectId: "ui-kit", contentHash: "" })];

const decoded = () =>
  decodePng(
    Uint8Array.from(
      atob((screen.getByTestId("pixel-canvas").querySelector("img")?.src ?? "").split(",")[1]!),
      (c) => c.charCodeAt(0),
    ),
  );
const at = (image: RgbaImage, x: number, y: number) => toHex(pixelAt(image, x, y));
/** A 4 × 4 image is shown 32 times its size here (no layout to fit): one pixel is 32 wide. */
const point = (x: number, y: number) => ({ clientX: x * 32 + 5, clientY: y * 32 + 5, button: 0 });
const press = (x: number, y: number, extra: object = {}) => {
  const canvas = screen.getByTestId("pixel-canvas");
  fireEvent.pointerDown(canvas, { ...point(x, y), pointerId: 1, ...extra });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
};
const tool = (name: string) =>
  within(screen.getByRole("group", { name: "Outil" })).getByRole("button", { name });
const bytesOf = (file: File) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });

/** The editor's parts one under the other, the tool held as the atelier holds it. */
function Stand({ image = icon, move }: { image?: Asset; move?: string }) {
  const [tool, setTool] = useState<StudioTool>("pencil");
  return (
    <PixelEditor
      projectId={"p1" as never}
      asset={image}
      tool={tool === "move" ? "pencil" : tool}
      onTool={setTool}
      move={move}
      layout={(parts) => (
        <div onKeyDown={parts.keys}>
          {parts.rail}
          {parts.controls}
          {parts.stage}
          {parts.status}
          {parts.colour}
          <SaveActions
            dirty={parts.dirty}
            busy={parts.busy}
            canSave
            error={parts.error}
            onSave={() => void parts.save()}
            onDiscard={parts.discard}
          />
          <output data-testid="held">{tool}</output>
        </div>
      )}
    />
  );
}

async function open(move?: string) {
  render(<Stand move={move} />);
  await screen.findByTestId("pixel-canvas");
}

describe("PixelEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAssetStore.getState().reset();
    const drawn = createImage(4, 4);
    for (let x = 0; x < 4; x++) paint(drawn, x, 0, RED);
    files.icon = encodePng(drawn);
    const cell = createImage(2, 2);
    cell.data.set(Array.from({ length: 4 }, () => [...GOLD]).flat());
    files["kit:cell"] = encodePng(cell);
  });

  it("draws a stroke with the image's colour, undoes it, and saves the same image retouched", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async () => asset("icon", { contentHash: "after" }));
    await open();
    // It opens on the colour the image uses most, with nothing to save or undo.
    expect(screen.getByTestId("pixel-colour").title).toBe("#ff0000");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();

    const canvas = screen.getByTestId("pixel-canvas");
    fireEvent.pointerDown(canvas, { ...point(0, 2), pointerId: 1 });
    fireEvent.pointerMove(canvas, { ...point(3, 2), pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect([0, 1, 2, 3].map((x) => at(decoded(), x, 2))).toEqual(Array(4).fill("#ff0000"));
    expect(at(decoded(), 0, 1)).toBe("#00000000");

    // One stroke, one step back; then forward again.
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(at(decoded(), 2, 2)).toBe("#00000000");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.keyDown(canvas, { key: "y", ctrlKey: true });
    expect(at(decoded(), 2, 2)).toBe("#ff0000");

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const [project, input] = upload.mock.calls[0]!;
    expect(project).toBe("p1");
    expect(input).toMatchObject({ type: "glyph", name: "icon", retouch: true });
    const sent = decodePng(await bytesOf(input.file));
    expect([sent.width, sent.height]).toEqual([4, 4]);
    expect([at(sent, 3, 0), at(sent, 3, 2), at(sent, 3, 3)]).toEqual([
      "#ff0000",
      "#ff0000",
      "#00000000",
    ]);
    await waitFor(() =>
      expect(useAssetStore.getState().assets.map((a) => a.contentHash)).toEqual(["after"]),
    );
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("erases, fills, picks a colour from the image and from the kit", async () => {
    await open();
    // The kit's colours are offered beside the image's own.
    const gold = await screen.findByRole("button", { name: "#c8a028" });
    fireEvent.click(gold);
    expect(screen.getByTestId("pixel-colour").title).toBe("#c8a028");

    fireEvent.click(tool("Pot de peinture"));
    press(1, 2);
    // The empty area below the red row, and the row untouched.
    expect([at(decoded(), 0, 1), at(decoded(), 3, 3), at(decoded(), 0, 0)]).toEqual([
      "#c8a028",
      "#c8a028",
      "#ff0000",
    ]);

    fireEvent.keyDown(screen.getByTestId("pixel-canvas"), { key: "e" });
    expect(tool("Gomme")).toHaveAttribute("aria-pressed", "true");
    press(2, 0);
    expect(at(decoded(), 2, 0)).toBe("#00000000");

    // Alt+click picks without leaving the tool; the pipette goes back to the pencil.
    press(0, 0, { altKey: true });
    expect(screen.getByTestId("pixel-colour").title).toBe("#ff0000");
    expect(tool("Gomme")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tool("Prendre une couleur"));
    press(1, 1);
    expect(screen.getByTestId("pixel-colour").title).toBe("#c8a028");
    expect(tool("Crayon")).toHaveAttribute("aria-pressed", "true");
    // On a transparent pixel there is nothing to pick but the eraser.
    press(2, 0, { altKey: true });
    expect(tool("Gomme")).toHaveAttribute("aria-pressed", "true");

    // A colour typed, with its transparency; then every change dropped at once.
    fireEvent.click(tool("Crayon"));
    fireEvent.change(screen.getByRole("textbox", { name: "Couleur" }), {
      target: { value: "#0000ff80" },
    });
    press(3, 3);
    expect(at(decoded(), 3, 3)).toBe("#0000ff80");
    fireEvent.click(screen.getByRole("button", { name: "Annuler les changements" }));
    expect([at(decoded(), 3, 3), at(decoded(), 2, 0)]).toEqual(["#00000000", "#ff0000"]);
    expect(screen.queryByRole("button", { name: "Annuler les changements" })).toBeNull();
  });

  it("says so when the image cannot be read", async () => {
    files.icon = undefined;
    render(<Stand image={asset("icon", { contentHash: "x" })} />);
    expect(await screen.findByText("Cette image ne peut pas être lue.")).toBeInTheDocument();
    // The tools stay in place, with nothing to draw on.
    expect(tool("Crayon")).toBeInTheDocument();
    expect(screen.queryByTestId("pixel-canvas")).toBeNull();
  });

  it("saves what was drawn before the move tool takes over, and keeps to drawing on a lone image", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async () => asset("icon", { contentHash: "after" }));
    await open();
    press(1, 2);
    fireEvent.click(tool("Déplacer le calque"));
    await waitFor(() => expect(screen.getByTestId("held")).toHaveTextContent("move"));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not offer to move an image that is not a layer among others", async () => {
    await open("Un seul calque");
    expect(tool("Déplacer le calque")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(tool("Déplacer le calque"));
    fireEvent.keyDown(screen.getByTestId("pixel-canvas"), { key: "v" });
    expect(screen.getByTestId("held")).toHaveTextContent("pencil");
  });
});
