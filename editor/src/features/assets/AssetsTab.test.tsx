import type { Asset } from "@/domain/asset";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsTab, useResourcesView } from "./AssetsTab";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));

let desktop = false;
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => desktop }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

const A1: Asset = {
  id: "asset_1",
  projectId: "p1",
  type: "texture" as const,
  name: "bg_one",
  width: 16,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["background"],
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
};
const A2: Asset = {
  id: "asset_2",
  projectId: "p1",
  type: "glyph" as const,
  name: "ico_one",
  width: 8,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h2",
  createdAt: "",
  updatedAt: "",
};

describe("AssetsTab", () => {
  beforeEach(() => {
    // AssetsTab no longer fetches itself — the assets are loaded by
    // `useAssetInit` mounted on EditorPane. Tests seed the store directly.
    useAssetStore.getState().reset();
    useResourcesView.getState().setView("files");
    useAssetStore.getState().setAssets([A1, A2]);
    desktop = false;
  });

  it("shows the selected image large beside the list on a wide screen", () => {
    desktop = true;
    render(<AssetsTab projectId={"p1" as never} />);
    expect(screen.queryByTestId("resources-detail")).toBeNull();
    fireEvent.click(screen.getByTitle("bg_one"));
    // Both panes at once, split by a handle the user drags.
    expect(screen.getByTitle("ico_one")).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByTestId("resources-detail")).toContainElement(
      screen.getByTestId("asset-stage"),
    );
  });

  it("shows the list or the selected image, one at a time, on a narrow screen", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByTitle("bg_one"));
    expect(screen.queryByTitle("ico_one")).toBeNull();
    expect(screen.getByTestId("asset-stage")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retour aux ressources/i }));
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("renders the assets from the store", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    expect(screen.getByTitle("bg_one")).toBeTruthy();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("marks in the list the owner's version of a shipped image, the one whose original changed and the one of another size", () => {
    const image = (id: string): Asset => ({ ...A1, id, name: id, usages: ["button"] });
    useAssetStore
      .getState()
      .setAssets([image("crest"), image("banner"), image("seal"), image("mine")]);
    const origin = (hash: string) => ({ module: "guilds", template: "base", version: 1, hash });
    // What the server recorded: the seal was drawn against an original the module replaced since.
    useProjectTemplatesStore.setState({
      entries: {
        p1: {
          status: "ready",
          hashes: {},
          origins: {
            "assets/textures/banner.png": origin("o2"),
            "originals/assets/textures/banner.png": origin("o2"),
            "assets/textures/seal.png": origin("o4"),
            "originals/assets/textures/seal.png": origin("o4b"),
          },
        },
      },
    });
    useProjectBaselineStore.setState({
      baselines: {
        p1: {
          "originals/assets/textures/crest.yml": "function: menu\nwidth: 54\nheight: 18\n",
          "assets/textures/crest.yml": "width: 20\nheight: 20\n",
        },
      },
      binaryBaselines: {
        p1: {
          "originals/assets/textures/crest.png": { hash: "o1", size: 1 },
          "assets/textures/crest.png": { hash: "m1", size: 1 },
          "originals/assets/textures/banner.png": { hash: "o2", size: 1 },
          "assets/textures/banner.png": { hash: "m2", size: 1 },
          "originals/assets/textures/seal.png": { hash: "o4b", size: 1 },
          "assets/textures/seal.png": { hash: "m4", size: 1 },
          "assets/textures/mine.png": { hash: "m3", size: 1 },
        },
      },
    });
    render(<AssetsTab projectId={"p1" as never} />);
    const mark = (title: RegExp) =>
      screen
        .getByLabelText(title)
        .querySelector("[data-testid=asset-mark]")
        ?.getAttribute("data-tone");
    expect(mark(/^crest · Autre taille/)).toBe("warning");
    expect(mark(/^banner · Votre version d'une image/)).toBe("brand");
    // What replaces an image below wears a word, not a dot.
    expect(screen.getByLabelText(/^banner · /)).toHaveTextContent("Surcharge");
    expect(screen.getByLabelText(/^crest · /)).not.toHaveTextContent("Surcharge");
    expect(mark(/^seal · Votre version : l'original du module a changé/)).toBe("warning");
    expect(screen.getByTitle("mine").querySelector("[data-testid=asset-mark]")).toBeNull();
    useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
    useProjectTemplatesStore.setState({ entries: {} });
  });

  it("opens the upload dialog when clicking Upload", () => {
    useAssetStore.getState().setAssets([]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/i }));
    expect(screen.getByRole("dialog", { name: /importer une image/i })).toBeTruthy();
  });

  it("marks as an override the base's image the server redrew, not one shipped and left alone", async () => {
    const { useKitStore } = await import("@/state/kitStore");
    useKitStore.setState({
      read: { projectId: "p1", files: {}, binaries: [], byName: true },
      own: {},
    } as never);
    const image = (id: string): Asset => ({ ...A1, id, name: id, contentHash: "h" });
    useAssetStore.getState().setAssets([image("window.6"), image("window.3")]);
    useProjectBaselineStore.setState({
      baselines: { p1: {} },
      binaryBaselines: {
        p1: {
          "originals/assets/textures/window.6.png": { hash: "o1", size: 1 },
          "originals/assets/textures/window.3.png": { hash: "o2", size: 1 },
          "assets/textures/window.3.png": { hash: "m2", size: 1 },
        },
      },
    });
    render(<AssetsTab projectId={"p1" as never} />);
    expect(screen.getByLabelText(/^window\.3/)).toHaveTextContent("Surcharge");
    expect(screen.getByTitle("window.6")).not.toHaveTextContent("Surcharge");
    useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
    useKitStore.setState({ read: undefined, own: {} } as never);
  });

  it("sends an image uploaded in a module to the server's library, and turns to it", async () => {
    const { useKitStore } = await import("@/state/kitStore");
    const libraryDraft = await import("./libraryDraft");
    useKitStore.setState({
      read: { projectId: "srv.artisan", files: {}, binaries: [], byName: true },
      own: {},
    } as never);
    vi.spyOn(libraryDraft, "openLibraryDraft").mockResolvedValue();
    const add = vi
      .spyOn(libraryDraft, "addToLibrary")
      .mockResolvedValue({ id: "crest", projectId: "srv.artisan", name: "crest" } as never);
    useAssetStore.getState().setAssets([]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/i }));
    fireEvent.change(screen.getByLabelText(/fichier/i), {
      target: { files: [new File(["png"], "crest.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Importer$/ }));
    // The list shows the common images, where the image now is.
    await waitFor(() =>
      expect(screen.getByTestId("project-source")).toHaveTextContent("Images communes"),
    );
    expect(add).toHaveBeenCalledWith("srv.artisan", expect.objectContaining({ name: "crest" }));
    vi.restoreAllMocks();
    useKitStore.setState({ read: undefined, own: {} } as never);
  });

  it("filters by search query (case-insensitive)", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.change(screen.getByPlaceholderText(/Rechercher/i), { target: { value: "ico" } });
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("filters by type chip", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Images de boutons$/i }));
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });
  it("groups legacy backgrounds and decorations with menu images and scopes imports", () => {
    useAssetStore
      .getState()
      .setAssets([
        A1,
        A2,
        { ...A1, id: "logo", name: "logo", usages: ["decoration"] },
        { ...A1, id: "frame", name: "frame", usages: ["menu"] },
      ]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Images du menu$/ }));
    for (const name of ["bg_one", "logo", "frame"]) expect(screen.getByTitle(name)).toBeTruthy();
    expect(screen.queryByTitle("ico_one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/ }));
    // The import files the image under the part shown: nothing to tick.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("keeps unclassified images accessible and separates no-results from load failures", () => {
    useAssetStore.getState().setAssets([{ ...A1, usages: [] }, A2]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /À classer/i }));
    expect(screen.getByTitle("bg_one")).toBeTruthy();
    expect(screen.queryByTitle("ico_one")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-found" } });
    expect(screen.getByRole("status")).toHaveTextContent(/Aucune ressource ne correspond/);
  });
  it("shows what goes in the players' pack only: no captured items among its views", () => {
    render(<AssetsTab projectId={"p1" as never} components={<div data-testid="components" />} />);
    const views = screen.getByTestId("resources-views");
    expect(
      within(views)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Images et polices", "Composants"]);
  });
});
