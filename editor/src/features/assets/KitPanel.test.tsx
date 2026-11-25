import type { Asset } from "@/domain/asset";
import { useKitStore } from "@/state/kitStore";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useResourcesView } from "./AssetsTab";
import { KitPanel } from "./KitPanel";
import { useAssetStore } from "./assetStore";

vi.mock("@/lib/projectPrincipal", () => ({ useProjectPrincipalId: () => "u1" }));
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));
const uploadAsset = vi.fn();
const deleteAsset = vi.fn();
vi.mock("@/lib/api/userAssets", () => ({
  uploadAsset: (...args: unknown[]) => uploadAsset(...args),
  deleteAsset: (...args: unknown[]) => deleteAsset(...args),
}));
const createProject = vi.fn();
vi.mock("@/lib/api/servers", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
}));

const image = (name: string, width: number, height: number): Asset => ({
  id: name,
  projectId: "kit",
  type: "glyph",
  name,
  width,
  height,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
});

const openProject = (id: string, diskId: string) =>
  useProjectsStore.setState((s) => ({
    openProjects: { ...s.openProjects, projects: [{ id, diskId } as never] },
  }));

describe("KitPanel", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    deleteAsset.mockReset();
    createProject.mockReset();
    useAssetStore.getState().reset();
    useKitStore.setState({ read: undefined, theme: undefined });
    useResourcesView.setState({ view: "kit", studio: null });
    openProject("p1", "shop");
  });

  it("lists the base as Artisan's and offers to create the kit module", async () => {
    createProject.mockResolvedValue({ id: "kit" });
    const onOpenProject = vi.fn();
    render(<KitPanel projectId={"p1" as never} serverId="s1" onOpenProject={onOpenProject} />);
    const slot = screen.getByTestId("kit-slot-button.3x1");
    expect(within(slot).getByText("kit:button.3x1")).toBeInTheDocument();
    expect(within(slot).getByText("54 × 18 px")).toBeInTheDocument();
    expect(within(slot).getByText("Artisan")).toBeInTheDocument();
    expect(within(slot).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Créer le module du kit" }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("kit"));
    expect(createProject).toHaveBeenCalledWith("s1", "ui-kit");
  });

  it("leads to the kit module, and shows what it redrew and its themes", () => {
    useKitStore.setState({
      read: {
        projectId: "kit",
        files: { "themes/noel/theme.yml": "colors: {}" },
        binaries: [
          { path: "assets/textures/button.3x1.png", hash: "abc" },
          { path: "assets/textures/logo.png", hash: "def" },
        ],
      },
      theme: undefined,
    });
    const onOpenProject = vi.fn();
    render(<KitPanel projectId={"p1" as never} serverId="s1" onOpenProject={onOpenProject} />);
    expect(
      within(screen.getByTestId("kit-slot-button.3x1")).getByText("Redessinée"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("kit-slot-cell")).getByText("Artisan")).toBeInTheDocument();
    expect(screen.getByText("kit:logo")).toBeInTheDocument();
    expect(screen.getByText("noel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le module du kit" }));
    expect(onOpenProject).toHaveBeenCalledWith("kit");
  });

  it("in the kit module, redraws a piece from Artisan's image and gives it back", async () => {
    openProject("kit", "ui-kit");
    const made = image("button.3x1", 54, 18);
    uploadAsset.mockResolvedValue(made);
    deleteAsset.mockResolvedValue(undefined);
    render(<KitPanel projectId={"kit" as never} />);
    const slot = screen.getByTestId("kit-slot-button.3x1");
    fireEvent.click(within(slot).getByRole("button", { name: "Redessiner" }));
    await waitFor(() => expect(useResourcesView.getState().view).toBe("files"));
    const [project, input] = uploadAsset.mock.calls[0] as [string, Record<string, unknown>];
    expect(project).toBe("kit");
    expect(input).toMatchObject({ name: "button.3x1", type: "glyph", usages: ["button"] });
    expect(useAssetStore.getState().selectedId).toBe("button.3x1");
    expect(useResourcesView.getState().studio).toBe("button.3x1");

    expect(within(slot).getByText("Redessinée")).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole("button", { name: "Remettre celle d'Artisan" }));
    await waitFor(() => expect(within(slot).getByText("Artisan")).toBeInTheDocument());
    expect(deleteAsset).toHaveBeenCalledWith("kit", "button.3x1");
  });

  it("a window of the base is a menu image, drawn from the window's top", async () => {
    openProject("kit", "ui-kit");
    uploadAsset.mockResolvedValue(image("window.6", 176, 222));
    render(<KitPanel projectId={"kit" as never} />);
    fireEvent.click(
      within(screen.getByTestId("kit-slot-window.6")).getByRole("button", { name: "Redessiner" }),
    );
    await waitFor(() => expect(uploadAsset).toHaveBeenCalled());
    expect(uploadAsset.mock.calls[0]?.[1]).toMatchObject({ usages: ["menu"], ascent: 13 });
  });
});
