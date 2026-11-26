import type { Asset } from "@/domain/asset";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsTab, useResourcesView } from "./AssetsTab";
import { useAssetStore } from "./assetStore";

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

  it("marks in the list the owner's version of a shipped image, and the one the pack does not take", () => {
    const image = (id: string): Asset => ({ ...A1, id, name: id, usages: ["button"] });
    useAssetStore.getState().setAssets([image("crest"), image("banner"), image("mine")]);
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
          "assets/textures/mine.png": { hash: "m3", size: 1 },
        },
      },
    });
    render(<AssetsTab projectId={"p1" as never} />);
    const mark = (title: RegExp) =>
      screen.getByTitle(title).querySelector("[data-testid=asset-mark]")?.getAttribute("data-tone");
    expect(mark(/^crest · Non prise/)).toBe("warning");
    expect(mark(/^banner · Votre version/)).toBe("brand");
    expect(screen.getByTitle("mine").querySelector("[data-testid=asset-mark]")).toBeNull();
    useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
  });

  it("opens the upload dialog when clicking Upload", () => {
    useAssetStore.getState().setAssets([]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/i }));
    expect(screen.getByRole("dialog", { name: /importer une image/i })).toBeTruthy();
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
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
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
  it("switches to the module's captured items, and back to its files", () => {
    useProjectsStore.setState({
      openProjects: {
        projects: [
          {
            id: "p1",
            name: "P1",
            capturedItems: [{ id: "ci_1", name: "Golden key", stackYaml: "", display: {} }],
          },
        ],
        projectOrder: ["p1"],
      },
    } as never);
    render(
      <AssetsTab
        projectId={"p1" as never}
        capturedItems={<div data-testid="captured-items-section" title="Golden key" />}
      />,
    );
    expect(screen.queryByTestId("captured-items-section")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Items capturés/ }));
    expect(screen.getByTestId("captured-items-section")).toBeTruthy();
    expect(screen.getByTitle("Golden key")).toBeTruthy();
    expect(screen.queryByTitle("bg_one")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Images et polices/ }));
    expect(screen.getByTitle("bg_one")).toBeTruthy();
  });
});
