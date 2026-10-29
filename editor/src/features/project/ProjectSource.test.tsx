import type { Asset } from "@/domain/asset";
import type { CapturedItem, Project, ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { useAssetStore } from "@/features/assets/assetStore";
import * as local from "@/features/assets/localAssets";
import { CapturedItemsSection } from "@/features/canvas/CapturedItemsSection";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import * as userAssets from "@/lib/api/userAssets";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLibraryStore } from "./projectLibraryStore";

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

const EDITED = "p_personal" as ProjectId;
const sword = {
  id: "ci_sword",
  name: "Épée du marchand",
  stackYaml: "type: DIAMOND_SWORD\n",
  display: { material: "DIAMOND_SWORD" },
} as CapturedItem;
const coin: Asset = {
  id: "coin",
  projectId: "p_shop_system",
  type: "texture",
  name: "coin",
  width: 16,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h-coin",
  createdAt: "",
  updatedAt: "",
};

function setup() {
  const open = mockOpenProjects();
  const shop = open.projects.find((p) => p.id === "p_shop_system")!;
  const edited = open.projects.find((p) => p.id === EDITED)!;
  useProjectsStore.setState({ openProjects: open });
  useServerIndexStore.setState({
    scope: "s",
    status: "ready",
    // The edited project's published copy is in the index too: it is never offered.
    projects: [{ ...shop, capturedItems: [sword] } as Project, edited],
    failed: [],
  });
  return { shop };
}

beforeEach(() => {
  useAssetStore.getState().reset();
  useProjectLibraryStore.setState({ sourceId: null });
  useUiStore.getState().setArmedMaterial(null);
});
afterEach(() => vi.restoreAllMocks());

const edited = () =>
  useProjectsStore.getState().openProjects.projects.find((p) => p.id === EDITED)!;

describe("using another project's resources", () => {
  it("offers the other projects only, and copies the chosen asset into this one", async () => {
    const { shop } = setup();
    const listed = vi.spyOn(local, "listLocalAssets").mockResolvedValue([coin]);
    const copied = { ...coin, projectId: EDITED, id: "coin_2", name: "coin_2" };
    const copy = vi
      .spyOn(userAssets, "copyAsset")
      .mockResolvedValue({ asset: copied, outcome: "renamed" });
    render(<AssetsTab projectId={EDITED} />);

    await userEvent.click(screen.getByTestId("project-source"));
    const options = screen.getAllByRole("menuitemradio").map((o) => o.textContent);
    expect(options).toHaveLength(2);
    expect(options).toContain(shop.name);
    await userEvent.click(screen.getByRole("menuitemradio", { name: shop.name }));

    // Read from the source's published disk, never a draft.
    expect(listed).toHaveBeenCalledWith("p_shop_system", {});
    await userEvent.click(await screen.findByTitle("coin"));
    await userEvent.click(screen.getByRole("button", { name: /copier dans ce projet|copy into/i }));

    expect(copy).toHaveBeenCalledWith(EDITED, coin);
    expect(useAssetStore.getState().assets).toContainEqual(copied);
    // Back on this project, with the copy selected.
    expect(useAssetStore.getState().selectedId).toBe("coin_2");
    expect(screen.getByTestId("project-source")).toHaveTextContent(/ce projet|this project/i);
  });

  it("copies another project's captured item when it is used", async () => {
    const { shop } = setup();
    render(<CapturedItemsSection projectId={EDITED} />);

    await userEvent.click(screen.getByTestId("project-source"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: shop.name }));
    expect(edited().capturedItems ?? []).toEqual([]);

    await userEvent.click(screen.getByTitle("Épée du marchand"));

    expect(edited().capturedItems).toEqual([sword]);
    expect(useUiStore.getState().armedMaterial).toBe("item:ci_sword");
    // The source keeps its item, untouched.
    expect(useServerIndexStore.getState().projects[0]?.capturedItems).toEqual([sword]);
  });
});
