/**
 * A collection kind (SDK 1.9), a shop's catalogue: its Documents leave the board and the
 * themed folders, the sidebar lists them under one entry, and its page shows the collection's
 * settings screen, a card per Document and the button that creates one.
 */
import "@/i18n";
import { resetDocumentKinds } from "@/domain/documentKinds";
import { documentsOf } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { projectBoard } from "@/features/canvas/autoLayout";
import { boardGraph, deriveServerGraph } from "@/features/canvas/serverGraph";
import { misplacedCollectionDocuments, projectCollections } from "@/lib/documentCollections";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { resetDocumentCodecs } from "@/schema/documentCodecs";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import type { DocumentKindContribution, FrontendModule } from "@artisan/editor-sdk";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { DocumentGroups } from "../project/ProjectDocumentTree";
import { CollectionView } from "./CollectionView";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ serverId: "s1" }),
}));

const PID = "boutique_addon" as ProjectId;
const base = "plugins/Artisan/projects/boutique_addon";

interface Category {
  id: string;
  projectId: ProjectId;
  name: string;
}

const categoryKind: DocumentKindContribution = {
  kind: "shop_category",
  dir: "shop_categories",
  schemaVersion: "shop_category/v1",
  projects: ["boutique_addon"],
  collection: { labels: { en: "Catalog", fr: "Catalogue" }, screen: "boutique:settings" },
  label: "Categories",
  component: () => null,
  title: (doc) => (doc as Category).name,
  create: ({ id, projectId }) => ({ id, projectId, name: id }),
  parse: (src) => ({ doc: src as unknown as Category, i18nKeys: {}, unsupported: [] }),
  serialize: (doc) => ({ name: (doc as Category).name }),
  board: { summary: () => "2 articles" },
};

const shop: FrontendModule = {
  id: "boutique",
  displayName: "Boutique",
  schemaVersion: "boutique/v1",
  sidebar: { icon: () => null, label: "Boutique", to: "/boutique" },
  routes: [],
  documents: [categoryKind],
};

function folder(): Project {
  return projectFromFiles(PID, {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n",
    [`${base}/data/shop_settings.yaml`]: "whole_shop_discount: 10\n",
    [`${base}/menus/shop_main.yml`]: "schema: menu/v1\ntitle: Shop\nrows: 3\n",
    [`${base}/shop_categories/kits.yml`]: "schema: shop_category/v1\nname: Kits\n",
    // Filed in a themed folder before collections existed: the shop never read it.
    [`${base}/catalogue/shop_categories/keys.yml`]: "schema: shop_category/v1\nname: Keys\n",
  });
}

const stored = () => useProjectsStore.getState().openProjects.projects[0]!;

beforeEach(() => {
  registerEditorModule(shop);
  useProjectsStore.setState({
    openProjects: { projects: [folder()], projectOrder: [PID] },
  } as never);
  useServerScreensStore.setState({
    screens: [
      {
        id: "boutique:settings",
        moduleId: "boutique",
        label: "Settings",
        table: "data/shop_settings",
        projectId: "boutique_addon",
      },
    ],
  } as never);
  navigate.mockReset();
});

afterEach(() => {
  clearRegistry();
  resetDocumentKinds();
  resetDocumentCodecs();
});

describe("a collection kind", () => {
  it("is a collection of the folder it is creatable in", () => {
    expect(projectCollections(stored()).map((c) => c.kind)).toEqual(["shop_category"]);
    expect(projectCollections({ id: "other", documents: {} } as never)).toEqual([]);
  });

  it("stays off the board; links keep the whole graph", () => {
    const graph = deriveServerGraph([stored()]);
    expect(graph.nodes.some((n) => n.kind === "shop_category")).toBe(true);
    expect(boardGraph(graph).nodes.map((n) => n.kind)).toEqual(["menu"]);
    expect(Object.keys(projectBoard(stored()).layout)).toEqual(["menu/shop_main"]);
  });

  it("never enters a themed folder, and goes back to the root from one", () => {
    expect(misplacedCollectionDocuments(stored())).toEqual(["shop_category/keys"]);
    const store = useProjectsStore.getState();
    store.moveToFolder({
      projectId: PID,
      nodeIds: misplacedCollectionDocuments(stored()),
      folder: "",
    });
    expect(misplacedCollectionDocuments(stored())).toEqual([]);

    store.createFolder({ projectId: PID, parent: "", name: "extras" });
    store.moveToFolder({
      projectId: PID,
      nodeIds: ["shop_category/kits", "menu/shop_main"],
      folder: "extras",
    });
    const docs = documentsOf(stored(), "shop_category");
    expect(docs.every((d) => !d.folder)).toBe(true);
    expect(documentsOf(stored(), "menu")[0]!.folder).toBe("extras");
  });

  it("is one sidebar entry, its Documents listed under it and nowhere else", () => {
    render(<DocumentGroups project={stored()} onOpen={() => {}} editable />);
    const entry = screen.getByTestId("collection-shop_category");
    expect(entry.textContent).toMatch(/Catalog/);
    expect(entry.textContent).toMatch(/2/);
    const catalog = screen.getByRole("list", { name: "Catalog" });
    expect(catalog.textContent).toMatch(/kits/);
    expect(catalog.textContent).toMatch(/keys/);
    expect(screen.getAllByText("keys")).toHaveLength(1);
    fireEvent.click(entry);
    expect(navigate).toHaveBeenCalledWith({
      to: "/servers/$serverId/projects/$projectId/collection/$collectionKind",
      params: { serverId: "s1", projectId: "boutique_addon", collectionKind: "shop_category" },
    });
  });

  it("has a page: its settings screen, a card per Document, a create button", () => {
    render(<CollectionView projectId={PID} kind="shop_category" />);
    expect(screen.getByRole("heading", { name: "Catalog" })).toBeTruthy();
    expect(screen.getByDisplayValue("10")).toBeTruthy();
    expect(screen.getAllByText("2 articles")).toHaveLength(2);
    fireEvent.click(screen.getByText("Kits"));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/servers/$serverId/projects/$projectId/document/$documentId",
        params: expect.objectContaining({ documentId: "kits" }),
        search: { kind: "shop_category" },
      }),
    );
    expect(screen.getByRole("button", { name: /Categories/ })).toBeTruthy();
  });

  it("refuses a kind that is not a collection", () => {
    render(<CollectionView projectId={PID} kind="menu" />);
    expect(screen.queryByTestId("collection-page")).toBeNull();
  });
});
