import type { Project, ProjectId } from "@/domain/types";
import { hashContent } from "@/lib/contentHash";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectDocumentTree } from "./ProjectDocumentTree";

const api = vi.hoisted(() => ({ fetchProjectOrigins: vi.fn() }));
vi.mock("@/lib/api/templates", () => api);

const PID = "srv.shop" as ProjectId;

it("marks a Document copied from a template, and a newer version its module ships", async () => {
  const content = "schema: menu/v1\nsize: 27\n";
  const copied = await hashContent(content);
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
    await screen.findByRole("img", { name: "quests propose une nouvelle version" }),
  ).toBeInTheDocument();
});
