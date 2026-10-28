import type { Project, ProjectId } from "@/domain/types";
import { hashContent } from "@/lib/contentHash";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectDocumentTree } from "./ProjectDocumentTree";
import { adoptDiskIntoProject, projectTree } from "./saveProjectToDisk";

const api = vi.hoisted(() => ({
  fetchProjectOrigins: vi.fn(),
  copyTemplate: vi.fn(),
  fetchTemplateFiles: vi.fn(),
}));
vi.mock("@/lib/api/templates", () => api);
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  // useOpenProjectSettings: outside a route, the gear opens the settings in place.
  useRouter: () => null,
}));

const PID = "srv.shop" as ProjectId;

it("marks a Document copied from a template, and a newer version its module ships", async () => {
  const content = "schema: menu/v1\nsize: 27\n";
  const copied = await hashContent(content);
  api.fetchTemplateFiles.mockResolvedValue({
    ok: true,
    files: { "menus/daily.yaml": "schema: menu/v1\nsize: 54\n" },
  });
  api.fetchProjectOrigins.mockResolvedValue({
    ok: true,
    origins: {
      "menus/daily.yaml": { module: "quests", template: "daily", version: 1, hash: copied },
    },
  });
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          diskId: "shop",
          name: "shop",
          documents: { menu: [{ id: "daily", projectId: PID, title: [], rows: 3, layers: [] }] },
          i18nKeys: {},
          defaultLang: "en",
          canvasLayout: {},
          dataSources: [],
        } as unknown as Project,
      ],
    },
  } as never);
  useProjectRuntimeStore.setState({
    current: {
      projectId: PID,
      serverId: "srv",
      minecraftVersion: null,
      capabilities: { canRename: false, liveData: true, captureInGame: false, preview: true },
      connection: { available: true },
    },
  });
  useProjectBaselineStore.getState().set(PID, { "menus/daily.yaml": content });
  useProjectTemplatesStore.setState({ entries: {} });
  useModulesStore.setState({
    active: [
      {
        id: "quests",
        version: "1",
        templates: [
          {
            id: "daily",
            title: "Daily",
            version: 2,
            files: [{ path: "menus/daily.yaml", hash: "v2", size: 1 }],
          },
        ],
      },
    ],
  });

  render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
  expect(
    await screen.findByRole("img", { name: /^quests propose une nouvelle version/ }),
  ).toBeInTheDocument();
  // A discreet asterisk, not a text chip.
  expect(
    screen.getByRole("img", { name: /^quests propose une nouvelle version/ }),
  ).toHaveTextContent("*");
  expect(screen.queryByText("nouvelle version")).toBeNull();
});

function shopProject(): Project {
  return {
    id: PID,
    diskId: "shop",
    name: "shop",
    documents: { menu: [{ id: "shop_main", projectId: PID, title: [], rows: 3, layers: [] }] },
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
    dataSources: [],
  } as unknown as Project;
}

async function openSystemMenu(shipped: string, published: string, system = true) {
  const hash = await hashContent(shipped);
  api.fetchProjectOrigins.mockResolvedValue({
    ok: true,
    origins: {
      "menus/shop_main.yaml": { module: "boutique", template: "menus", version: 1, hash },
    },
  });
  api.fetchTemplateFiles.mockResolvedValue({
    ok: true,
    files: { "menus/shop_main.yaml": shipped },
  });
  useProjectsStore.setState({
    openProjects: { projectOrder: [PID], projects: [shopProject()] },
  } as never);
  useProjectRuntimeStore.setState({
    current: {
      projectId: PID,
      serverId: "srv",
      minecraftVersion: null,
      capabilities: { canRename: false, liveData: true, captureInGame: false, preview: true },
      connection: { available: true },
    },
  });
  useProjectBaselineStore.getState().set(PID, { "menus/shop_main.yaml": published });
  useProjectTemplatesStore.setState({ entries: {}, shipped: {} });
  useModulesStore.setState({
    active: [
      {
        id: "boutique",
        version: "1",
        templates: [
          {
            id: "menus",
            title: "menus",
            version: 1,
            system,
            files: [{ path: "menus/shop_main.yaml", hash, size: 1 }],
          },
        ],
      },
    ],
  });
}

const SHIPPED = 'schema: menu/v1\nid: shop_main\ntitle: "Shop"\nsize: 54\n';

it("marks a module's system menu, never deleted or moved: Reset puts the module's version back into the draft", async () => {
  await openSystemMenu(SHIPPED, "schema: menu/v1\nid: shop_main\ntitle: Mine\nsize: 27\n");
  // Unpublished work elsewhere does not block it: the reset is one more draft edit.
  useProjectDraftStore.getState().save(PID, {
    initialTree: { "menus/other.yaml": "a" },
    tree: { "menus/other.yaml": "b" },
  } as never);
  vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
  expect(
    await screen.findByRole("img", { name: "Différent de la version de boutique" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole("img", { name: /Élément interne du module boutique/ }),
  ).not.toHaveLength(0);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Options" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByRole("menuitem", { name: "Réinitialiser" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Supprimer" })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Réinitialiser" }));

  await waitFor(() => {
    const menu = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PID)
      ?.documents.menu?.find((m) => m.id === "shop_main");
    expect((menu as { rows?: number } | undefined)?.rows).toBe(6);
  });
  // Nothing is written on the server: Deploy publishes it.
  expect(api.copyTemplate).not.toHaveBeenCalled();
});

it("a system menu deployed from the editor, the same once formatted, is still the module's version", async () => {
  const canonical = projectTree(
    adoptDiskIntoProject(shopProject(), { "menus/shop_main.yaml": SHIPPED }, []),
  )["menus/shop_main.yaml"];
  expect(canonical).toBeDefined();
  expect(canonical).not.toBe(SHIPPED);
  await openSystemMenu(SHIPPED, canonical as string);

  render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
  expect(
    await screen.findByRole("img", { name: /Élément interne du module boutique/ }),
  ).toBeInTheDocument();
  await waitFor(() => expect(api.fetchTemplateFiles).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByRole("img", { name: "Différent de la version de boutique" })).toBeNull(),
  );
});

it("a copy the module ships again in CRLF, the same value, is not a new version", async () => {
  // Copied from a jar built on Windows, the module now ships the same file in LF.
  await openSystemMenu(SHIPPED, SHIPPED.replaceAll("\n", "\r\n"), false);

  render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
  await waitFor(() => expect(api.fetchTemplateFiles).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByRole("img", { name: /propose une nouvelle version/ })).toBeNull(),
  );
  expect(screen.queryByRole("img", { name: /Modifié depuis/ })).toBeNull();
});

it("an edited copy takes its module's version from the row's menu, still deletable", async () => {
  await openSystemMenu(SHIPPED, "schema: menu/v1\nid: shop_main\ntitle: Mine\nsize: 27\n", false);
  vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
  expect(await screen.findByRole("img", { name: "Modifié depuis boutique" })).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Options" }), {
    button: 0,
    ctrlKey: false,
  });
  const take = await screen.findByRole("menuitem", { name: "Prendre la version de boutique" });
  expect(screen.getByRole("menuitem", { name: /^Supprimer/ })).toBeInTheDocument();
  fireEvent.click(take);

  await waitFor(() => {
    const menu = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PID)
      ?.documents.menu?.find((m) => m.id === "shop_main");
    expect((menu as { rows?: number } | undefined)?.rows).toBe(6);
  });
  expect(api.copyTemplate).not.toHaveBeenCalled();
});
