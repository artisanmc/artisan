import type { Asset } from "@/domain/asset";
import type { CapturedItem, Project, ProjectId } from "@/domain/types";
import { AssetsTab, useResourcesView } from "@/features/assets/AssetsTab";
import { useAssetStore } from "@/features/assets/assetStore";
import * as local from "@/features/assets/localAssets";
import { CapturedItemsSection } from "@/features/canvas/CapturedItemsSection";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import * as userAssets from "@/lib/api/userAssets";
import { mockOpenProjects } from "@/mock/fixtures";
import { useKitStore } from "@/state/kitStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen, within } from "@testing-library/react";
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
  useKitStore.setState({ read: undefined, theme: undefined });
  useResourcesView.setState({ piece: null, pieceFrom: null });
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
    // This module, the common images, all modules, then the one other module (the edited one's
    // published copy is never offered).
    expect(options).toHaveLength(4);
    expect(options).toContain(shop.name);
    await userEvent.click(screen.getByRole("menuitemradio", { name: shop.name }));

    // Read from the source's published disk, never a draft.
    expect(listed).toHaveBeenCalledWith("p_shop_system", { composed: false });
    await userEvent.click(await screen.findByTitle("coin"));
    await userEvent.click(screen.getByRole("button", { name: /copier dans ce module|copy into/i }));

    expect(copy).toHaveBeenCalledWith(EDITED, coin);
    expect(useAssetStore.getState().assets).toContainEqual(copied);
    // Back on this project, with the copy selected.
    expect(useAssetStore.getState().selectedId).toBe("coin_2");
    expect(screen.getByTestId("project-source")).toHaveTextContent(/ce module|this module/i);
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

  it("searches every project at once, this one included, naming each one", async () => {
    const open = mockOpenProjects();
    const shop = open.projects.find((p) => p.id === "p_shop_system")!;
    const quests = open.projects.find((p) => p.id === "p_daily_quests")!;
    useProjectsStore.setState({ openProjects: open });
    const bow = { ...sword, id: "ci_bow", name: "Arc des quêtes" } as CapturedItem;
    useServerIndexStore.setState({
      scope: "s",
      status: "ready",
      projects: [
        { ...shop, capturedItems: [sword] } as Project,
        { ...quests, capturedItems: [bow] } as Project,
      ],
      failed: [],
    });
    // The same name lives in both projects: two tiles, told apart by their project.
    const questCoin = { ...coin, projectId: "p_daily_quests", contentHash: "h-other" };
    const listed = vi
      .spyOn(local, "listLocalAssets")
      .mockImplementation(async (id) => (id === "p_shop_system" ? [coin] : [questCoin]));
    // This project's own coin, read live from the asset store, never from its disk.
    const ownCoin = { ...coin, projectId: EDITED, contentHash: "h-own" };
    useAssetStore.setState({ assets: [ownCoin] });
    render(<AssetsTab projectId={EDITED} />);

    await userEvent.click(screen.getByTestId("project-source"));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: /tous les modules|all modules/i }),
    );

    expect(listed.mock.calls.map(([id]) => id).sort()).toEqual(["p_daily_quests", "p_shop_system"]);
    expect(await screen.findByTitle(`coin · ${shop.name}`)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle(`coin · ${quests.name}`));
    expect(screen.getByTestId("other-asset-detail")).toHaveTextContent(quests.name);

    // This project's own one is listed too, and opened in place rather than copied.
    const copy = vi.spyOn(userAssets, "copyAsset");
    await userEvent.click(
      screen.getByRole("button", { name: /retour aux ressources|back to resources/i }),
    );
    await userEvent.click(screen.getByTitle(/^coin · (ce module|this module)$/));
    await userEvent.click(
      screen.getByRole("button", { name: /ouvrir dans ce module|open in this module/i }),
    );
    expect(copy).not.toHaveBeenCalled();
    expect(useAssetStore.getState().selectedId).toBe("coin");
    expect(screen.getByTestId("project-source")).toHaveTextContent(/ce module|this module/i);
  });

  it("lists every project's captured items, grouped and searchable", async () => {
    const open = mockOpenProjects();
    const shop = open.projects.find((p) => p.id === "p_shop_system")!;
    const quests = open.projects.find((p) => p.id === "p_daily_quests")!;
    useProjectsStore.setState({ openProjects: open });
    const bow = { ...sword, id: "ci_bow", name: "Arc des quêtes", stackYaml: "type: BOW\n" };
    useServerIndexStore.setState({
      scope: "s",
      status: "ready",
      projects: [
        { ...shop, capturedItems: [sword] } as Project,
        { ...quests, capturedItems: [bow as CapturedItem] } as Project,
      ],
      failed: [],
    });
    const shield = { ...sword, id: "ci_shield", name: "Bouclier maison" } as CapturedItem;
    useProjectsStore.setState({
      openProjects: {
        ...open,
        projects: open.projects.map((p) =>
          p.id === EDITED ? { ...p, capturedItems: [shield] } : p,
        ),
      },
    });
    render(<CapturedItemsSection projectId={EDITED} />);

    await userEvent.click(screen.getByTestId("project-source"));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: /tous les modules|all modules/i }),
    );
    expect(screen.getByText(shop.name)).toBeInTheDocument();
    expect(screen.getByText(quests.name)).toBeInTheDocument();
    // This module is listed too, first and named as such.
    expect(screen.getByText(/\((ce module|this module)\)$/)).toBeInTheDocument();
    // Its own item is used in place, never copied again.
    await userEvent.click(screen.getByTitle("Bouclier maison"));
    expect(useUiStore.getState().armedMaterial).toBe("item:ci_shield");
    expect(edited().capturedItems?.map((c) => c.id)).toEqual(["ci_shield"]);

    await userEvent.type(screen.getByRole("textbox"), "arc des");
    expect(screen.queryByTitle("Épée du marchand")).toBeNull();
    await userEvent.click(screen.getByTitle("Arc des quêtes"));
    expect(edited().capturedItems?.map((c) => c.id)).toEqual(["ci_shield", "ci_bow"]);
  });

  it("shows the common images apart from the other modules, named and opened where they live", async () => {
    const { shop } = setup();
    // The index lists the common images' Project too: it is not one of the other modules.
    const theme = { ...shop, id: "p_artisan" as ProjectId, name: "artisan" } as Project;
    // A published menu of the shop names a piece of the base.
    const naming = {
      ...shop,
      documents: {
        ...shop.documents,
        menu: [{ id: "vitrine", slots: { 0: { appearance: { image: { asset: "button.3x1" } } } } }],
      },
    } as unknown as Project;
    useServerIndexStore.setState({
      projects: [
        ...useServerIndexStore.getState().projects.filter((p) => p.id !== shop.id),
        naming,
        theme,
      ],
    });
    useKitStore.setState({
      read: { projectId: "p_artisan", files: {}, binaries: [], byName: true },
    });
    // The open module holds a `close.1x1` of its own.
    useAssetStore
      .getState()
      .setAssets([{ ...coin, id: "close.1x1", name: "close.1x1", projectId: EDITED }]);
    const onOpenCommon = vi.fn();
    const onOpenMenu = vi.fn();
    render(<AssetsTab projectId={EDITED} onOpenCommon={onOpenCommon} onOpenMenu={onOpenMenu} />);

    await userEvent.click(screen.getByTestId("project-source"));
    const options = screen.getAllByRole("menuitemradio").map((o) => o.textContent);
    expect(options).toHaveLength(4);
    expect(options).not.toContain("artisan");
    await userEvent.click(screen.getByRole("menuitemradio", { name: /images communes/i }));

    // A piece of the base nobody else names: a menu writes its name alone.
    await userEvent.click(await screen.findByTitle("button.3x1"));
    expect(screen.getByTestId("common-asset-ref")).toHaveTextContent(/^button\.3x1$/);
    // The menus of the server that name it, each a way to that menu.
    await userEvent.click(
      within(screen.getByTestId("common-asset-uses")).getByRole("button", {
        name: `vitrine · ${shop.name}`,
      }),
    );
    expect(onOpenMenu).toHaveBeenCalledWith(shop.id, "vitrine");
    // The open module holds this name: `artisan:` names the common one.
    await userEvent.click(screen.getByRole("button", { name: "Retour aux ressources" }));
    await userEvent.click(screen.getByTitle("close.1x1"));
    expect(screen.getByTestId("common-asset-ref")).toHaveTextContent("artisan:close.1x1");
    expect(screen.getByTestId("common-asset-uses")).toHaveTextContent(
      "Aucun menu du serveur ne la nomme.",
    );

    await userEvent.click(screen.getByRole("button", { name: /redessiner pour le serveur/i }));
    expect(onOpenCommon).toHaveBeenCalled();
    expect(useResourcesView.getState()).toMatchObject({ piece: "close.1x1", pieceFrom: EDITED });
  });

  it("has no entry for the common images in their own Project", async () => {
    setup();
    useKitStore.setState({ read: { projectId: EDITED, files: {}, binaries: [], byName: true } });
    render(<AssetsTab projectId={EDITED} />);
    await userEvent.click(screen.getByTestId("project-source"));
    expect(screen.queryByRole("menuitemradio", { name: /images communes/i })).toBeNull();
  });
});
