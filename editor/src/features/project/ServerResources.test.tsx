import type { Asset } from "@/domain/asset";
import type { Project, ProjectId } from "@/domain/types";
import * as local from "@/features/assets/localAssets";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { mockOpenProjects } from "@/mock/fixtures";
import { useKitStore } from "@/state/kitStore";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_COMMON, ServerResources, WHOLE_SERVER } from "./ServerResources";

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
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

const image = (projectId: string, id: string): Asset => ({
  id,
  projectId,
  type: "texture",
  name: id,
  width: 16,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["button"],
  contentHash: `h-${id}`,
  createdAt: "",
  updatedAt: "",
});

/** A published module whose one menu writes `refs`. */
function moduleNaming(base: Project, id: string, name: string, menu: string, refs: string[]) {
  return {
    ...base,
    id: id as ProjectId,
    diskId: undefined,
    name,
    documents: {
      ...base.documents,
      menu: [
        {
          id: menu,
          slots: Object.fromEntries(
            refs.map((asset, i) => [i, { appearance: { image: { asset } } }]),
          ),
        },
      ],
    },
  } as unknown as Project;
}

const read = (id: string, paths: string[]) =>
  ({ summary: { id }, files: {}, binaries: paths.map((path) => ({ path, hash: "h" })) }) as never;

function setup() {
  const base = mockOpenProjects().projects[0]!;
  const shop = moduleNaming(base, "shop", "Boutique", "vitrine", ["coin", "button.3x1"]);
  const guilds = moduleNaming(base, "guilds", "Guildes", "liste", ["shop:coin", "blason"]);
  const theme = {
    ...base,
    id: "p_artisan" as ProjectId,
    name: "artisan",
    documents: {},
  } as Project;
  useServerIndexStore.setState({
    scope: "s",
    status: "ready",
    projects: [shop, guilds, theme],
    reads: [
      read("shop", ["assets/textures/coin.png"]),
      read("guilds", ["assets/textures/blason.png"]),
    ],
    failed: [],
  });
  useKitStore.setState({
    read: { projectId: "p_artisan", files: {}, binaries: [], byName: true },
  });
  vi.spyOn(local, "listLocalAssets").mockImplementation(async (projectId) =>
    projectId === "shop" ? [image("shop", "coin")] : [image("guilds", "blason")],
  );
}

const callbacks = () => ({
  onScope: vi.fn(),
  onOpenModule: vi.fn(),
  onOpenCommon: vi.fn(),
  onOpenMenu: vi.fn(),
});

beforeEach(() => {
  useKitStore.setState({ read: undefined, theme: undefined });
  useServerIndexStore.getState().reset();
});
afterEach(() => vi.restoreAllMocks());

describe("the server's Resources", () => {
  it("lists every module's images with the common ones, each with its provider and its menus", async () => {
    setup();
    const on = callbacks();
    render(<ServerResources scope={WHOLE_SERVER} common={<p>communes</p>} {...on} />);

    // A module's image: its module, the menus that name it (its own and another module's), the way there.
    await userEvent.click(await screen.findByTitle("coin · Boutique"));
    expect(screen.getByTestId("server-asset-provider")).toHaveTextContent("Boutique");
    const uses = within(screen.getByTestId("server-asset-uses"));
    expect(uses.getByRole("button", { name: "vitrine · Boutique" })).toBeInTheDocument();
    await userEvent.click(uses.getByRole("button", { name: "liste · Guildes" }));
    expect(on.onOpenMenu).toHaveBeenCalledWith("guilds", "liste");
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir dans Boutique" }));
    expect(on.onOpenModule).toHaveBeenCalledWith("shop", "coin");

    // A common image: Artisan's, named by the shop's menu, redrawn among the common images.
    await userEvent.click(screen.getByRole("button", { name: "Retour aux ressources" }));
    await userEvent.click(screen.getByTitle("button.3x1 · Images communes"));
    expect(screen.getByTestId("server-asset-provider")).toHaveTextContent("Images communes");
    expect(
      within(screen.getByTestId("server-asset-detail")).getByText("Artisan"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("server-asset-uses")).getByRole("button", {
        name: "vitrine · Boutique",
      }),
    ).toBeInTheDocument();
    // A piece as shipped has no original to show beside it.
    expect(screen.queryByTestId("common-image-original")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /redessiner pour le serveur/i }));
    expect(on.onOpenCommon).toHaveBeenCalledWith("button.3x1");

    // The theme's own Project is not one of the modules.
    await userEvent.click(screen.getByRole("button", { name: "Retour aux ressources" }));
    await userEvent.click(screen.getByTestId("server-resources-scope"));
    expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual([
      "Tout le serveur",
      "Images communes",
      "Boutique",
      "Guildes",
    ]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Guildes" }));
    expect(on.onScope).toHaveBeenCalledWith("guilds");
  });

  it("shows one module's images alone, and the common images on their own page", async () => {
    setup();
    const on = callbacks();
    const { rerender } = render(
      <ServerResources scope="guilds" common={<p>communes</p>} {...on} />,
    );
    expect(await screen.findByTitle("blason · Guildes")).toBeInTheDocument();
    expect(screen.queryByTitle("coin · Boutique")).toBeNull();
    expect(screen.queryByTitle("button.3x1 · Images communes")).toBeNull();
    // Its own menu names it by its name alone.
    await userEvent.click(screen.getByTitle("blason · Guildes"));
    expect(
      within(screen.getByTestId("server-asset-uses")).getByRole("button", {
        name: "liste · Guildes",
      }),
    ).toBeInTheDocument();

    rerender(<ServerResources scope={SERVER_COMMON} common={<p>communes</p>} {...on} />);
    expect(screen.getByText("communes")).toBeInTheDocument();
    expect(screen.queryByTestId("server-asset-detail")).toBeNull();
  });

  it("shows Artisan's original beside a piece the server redrew, and says when it is not taken", async () => {
    setup();
    // A piece the server redrew: Artisan's original beside it; at another size, not taken.
    useKitStore.setState({
      read: {
        projectId: "p_artisan",
        files: {
          "assets/textures/close.1x1.yml": "width: 16\nheight: 16\n",
          "assets/textures/back.1x1.yml": "width: 20\nheight: 16\n",
        },
        binaries: [
          { path: "assets/textures/close.1x1.png", hash: "h1" },
          { path: "assets/textures/back.1x1.png", hash: "h2" },
        ],
        byName: true,
      },
    });
    render(<ServerResources scope={WHOLE_SERVER} common={<p>communes</p>} {...callbacks()} />);
    await userEvent.click(await screen.findByTitle("close.1x1 · Images communes"));
    const redrawn = within(screen.getByTestId("server-asset-detail"));
    expect(redrawn.getByText("Redessinée")).toBeInTheDocument();
    expect(redrawn.getByTestId("common-image-original")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retour aux ressources" }));
    await userEvent.click(screen.getByTitle("back.1x1 · Images communes"));
    const misfit = within(screen.getByTestId("server-asset-detail"));
    expect(misfit.getByText("Non prise")).toBeInTheDocument();
    expect(misfit.getByRole("alert")).toHaveTextContent("20 × 16 px, la pièce 16 × 16 px");
    expect(misfit.getByTestId("common-image-original")).toBeInTheDocument();
  });
});
