import type { Project, ProjectId } from "@/domain/types";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleTemplatesDialog } from "./ModuleTemplatesDialog";

const api = vi.hoisted(() => ({
  fetchProjectOrigins: vi.fn(),
  copyTemplate: vi.fn(),
  fetchTemplateFiles: vi.fn(),
}));
vi.mock("@/lib/api/templates", () => api);

const PID = "srv.shop" as ProjectId;
const template = {
  id: "daily",
  title: "Daily quests",
  version: 1,
  files: [{ path: "menus/daily.yaml", hash: "shipped", size: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          diskId: "shop",
          name: "shop",
          documents: { menu: [], command: [], dialog: [] },
          i18nKeys: {},
          defaultLang: "en",
          canvasLayout: {},
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
  useProjectBaselineStore.getState().set(PID, { "manifest.yaml": "schema: manifest/v1\n" });
  useProjectTemplatesStore.setState({ entries: {} });
  useModulesStore.setState({ active: [{ id: "quests", version: "1", templates: [template] }] });
  api.fetchProjectOrigins.mockResolvedValue({ ok: true, origins: {} });
});

describe("ModuleTemplatesDialog", () => {
  it("lists the templates the server's modules offer, with each file's state", async () => {
    render(<ModuleTemplatesDialog projectId={PID} open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("Daily quests")).toBeInTheDocument();
    expect(screen.getByText("menus/daily.yaml")).toBeInTheDocument();
    expect(screen.getByText("Non ajouté")).toBeInTheDocument();
    expect(api.fetchProjectOrigins).toHaveBeenCalledWith({ serverId: "srv", diskId: "shop" });
  });

  it("asks before replacing the files a copy would overwrite", async () => {
    api.copyTemplate
      .mockResolvedValueOnce({ ok: false, error: "conflict", conflicts: ["menus/daily.yaml"] })
      .mockResolvedValueOnce({ ok: true, written: ["menus/daily.yaml"], unchanged: [] });
    const user = userEvent.setup();
    render(<ModuleTemplatesDialog projectId={PID} open onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Ajouter au projet" }));
    expect(api.copyTemplate).toHaveBeenLastCalledWith(
      { serverId: "srv", diskId: "shop" },
      { module: "quests", template: "daily", replace: false },
    );
    await user.click(
      await screen.findByRole("button", { name: "Remplacer par la version du module" }),
    );
    await waitFor(() =>
      expect(api.copyTemplate).toHaveBeenLastCalledWith(
        { serverId: "srv", diskId: "shop" },
        { module: "quests", template: "daily", paths: ["menus/daily.yaml"], replace: true },
      ),
    );
  });

  it("shows the default version read-only, to copy from", async () => {
    api.fetchTemplateFiles.mockResolvedValue({
      ok: true,
      files: { "menus/daily.yaml": "schema: menu/v1\nsize: 27\ntitle: Daily\n" },
    });
    const user = userEvent.setup();
    render(<ModuleTemplatesDialog projectId={PID} open onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Ouvrir la version par défaut" }));
    expect(await screen.findByText("Menu daily")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copier 0 élément" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Copier 1 élément" })).toBeEnabled();
  });
});
