import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { KIT_ASCENT } from "@/lib/pack/kit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeNewDialog } from "./ComposeNewDialog";
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
  width: 176,
  height: 222,
  ascent: KIT_ASCENT,
  codepoint: 57344,
  fontMeta: null,
  contentHash: name,
  createdAt: "",
  updatedAt: "",
});

describe("ComposeNewDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAssetStore.getState().reset();
  });

  function open() {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <ComposeNewDialog projectId={"p1" as never} open onClose={onClose} onCreated={onCreated} />,
    );
    return { onCreated, onClose };
  }
  const name = () => screen.getByRole("textbox");
  const create = () => screen.getByRole("button", { name: "Créer" });

  it("starts a menu window from the kit's, drawn from the top of the title", async () => {
    const compose = vi
      .spyOn(userAssetsApi, "composeAsset")
      .mockImplementation(async (_project, input) => made(input.name));
    const { onCreated, onClose } = open();
    // A name the pack cannot hold creates nothing.
    fireEvent.change(name(), { target: { value: "Guild Hall" } });
    expect(create()).toBeDisabled();
    fireEvent.change(name(), { target: { value: "guild_hall" } });
    fireEvent.click(create());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made("guild_hall")));
    expect(compose).toHaveBeenCalledWith("p1", {
      name: "guild_hall",
      usages: ["menu"],
      ascent: KIT_ASCENT,
      recipe: {
        layers: [{ image: "kit:window.6", x: 0, y: 0, columns: 1, rows: 1 }],
        width: null,
        height: null,
      },
    });
    expect(useAssetStore.getState().assets.map((a) => a.id)).toEqual(["guild_hall"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("starts a button from the kit's, and shows why a creation was refused", async () => {
    const compose = vi
      .spyOn(userAssetsApi, "composeAsset")
      .mockRejectedValue(new Error("Asset name already exists"));
    const { onCreated, onClose } = open();
    fireEvent.change(name(), { target: { value: "join" } });
    fireEvent.click(screen.getByRole("button", { name: "Un bouton" }));
    fireEvent.click(create());
    expect((await screen.findByRole("alert")).textContent).toBe("Asset name already exists");
    expect(compose.mock.calls[0]![1]).toEqual({
      name: "join",
      usages: ["button"],
      recipe: {
        layers: [{ image: "kit:button.3x1", x: 0, y: 0, columns: 1, rows: 1 }],
        width: null,
        height: null,
      },
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
