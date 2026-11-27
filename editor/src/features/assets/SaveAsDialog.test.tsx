import type { Asset } from "@/domain/asset";
import type { ImageUse } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveAsDialog } from "./SaveAsDialog";
import { useResourcesView } from "./resourcesView";

const uses = new Map<string, ImageUse[]>();
vi.mock("@/features/project/imageUses", () => ({ useImageUses: () => uses }));
vi.mock("./assetBytes", () => ({ assetBytes: async () => new Uint8Array([7]) }));
const createProject = vi.fn();
vi.mock("@/lib/api/servers", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
}));

const asset: Asset = {
  id: "button.3x1",
  projectId: "kit",
  type: "glyph",
  name: "button.3x1",
  width: 54,
  height: 18,
  ascent: 9,
  codepoint: null,
  fontMeta: null,
  contentHash: "h",
  usages: ["button"],
  createdAt: "",
  updatedAt: "",
};
const kitRead = (projectId: string) => ({ projectId, files: {}, binaries: [] });
const server = () => ({ serverKeyId: "srv", open: vi.fn(), reread: vi.fn() });
const use = (projectId: string, menuId: string): ImageUse => ({
  projectId,
  projectName: projectId,
  menuId,
});

describe("SaveAsDialog", () => {
  beforeEach(() => {
    createProject.mockReset();
    uses.clear();
    uses.set("artisan:button.3x1", [use("shop", "main"), use("guilds", "home")]);
    useKitStore.setState({
      read: kitRead("kit"),
      own: { noel: kitRead("t-noel") },
      modules: [{ ...kitRead("shop"), folder: "boutique" }],
      themes: ["noel"],
    });
    useResourcesView.setState({ saveAs: null });
  });

  it("says what the copy changes, and asks the place to write it", async () => {
    const on = server();
    const onClose = vi.fn();
    render(<SaveAsDialog projectId="kit" asset={asset} server={on} onClose={onClose} />);
    // The first place that is not the image's own: the highest theme.
    expect((screen.getByLabelText("Où") as HTMLSelectElement).value).toBe("t-noel");
    expect(screen.getByTestId("save-as-effect")).toHaveTextContent(
      "Remplace l'image de ce nom dans 2 menus de 2 modules.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(on.open).toHaveBeenCalledWith("t-noel"));
    expect(useResourcesView.getState().saveAs).toMatchObject({
      name: "button.3x1",
      type: "glyph",
      ascent: 9,
      usages: ["button"],
      target: "t-noel",
      from: "kit",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("offers no module as a place, and refuses the same name in the same place", () => {
    render(<SaveAsDialog projectId="kit" asset={asset} server={server()} onClose={vi.fn()} />);
    const where = screen.getByLabelText("Où") as HTMLSelectElement;
    expect([...where.options].map((o) => o.value).filter((v) => v === "shop")).toEqual([]);
    fireEvent.change(where, { target: { value: "kit" } });
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "big" } });
    expect(screen.getByTestId("save-as-effect")).toHaveTextContent("ajoutée à cet endroit");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });

  it("saves a module's own image into a theme under that module, its name kept", async () => {
    const on = server();
    const banner = { ...asset, id: "banner", name: "banner", projectId: "shop" };
    render(<SaveAsDialog projectId="shop" asset={banner} server={on} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Où") as HTMLSelectElement).value).toBe("t-noel");
    expect(screen.getByLabelText("Nom")).toBeDisabled();
    expect(screen.getByTestId("save-as-effect")).toHaveTextContent(
      "Remplace « banner » du module « boutique » quand ce thème est en place.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(on.open).toHaveBeenCalledWith("t-noel"));
    expect(useResourcesView.getState().saveAs).toMatchObject({
      name: "banner",
      target: "t-noel",
      from: "shop",
      under: "boutique",
    });
  });

  it("saves a module's own image into the library under a name, as any image", () => {
    const banner = { ...asset, id: "banner", name: "banner", projectId: "shop" };
    render(<SaveAsDialog projectId="shop" asset={banner} server={server()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Où"), { target: { value: "kit" } });
    expect(screen.getByLabelText("Nom")).toBeEnabled();
    expect(screen.getByTestId("save-as-effect")).toHaveTextContent("ajoutée à cet endroit");
  });

  it("creates the theme on the way, and reads the server's themes again", async () => {
    createProject.mockResolvedValue({ id: "t-hiver" });
    const on = server();
    render(<SaveAsDialog projectId="kit" asset={asset} server={on} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Où"), {
      target: { value: (screen.getByText("Nouveau thème…") as HTMLOptionElement).value },
    });
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nom du thème"), { target: { value: "hiver" } });
    expect(screen.getByTestId("save-as-effect")).toHaveTextContent("Ce thème est rangé");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(on.open).toHaveBeenCalledWith("t-hiver"));
    expect(createProject).toHaveBeenCalledWith("srv", "hiver", "theme");
    expect(on.reread).toHaveBeenCalled();
    expect(useResourcesView.getState().saveAs?.target).toBe("t-hiver");
  });
});
