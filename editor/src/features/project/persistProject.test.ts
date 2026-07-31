import { projectId } from "@/domain/ids";
import type { Project } from "@/domain/types";
import { saveUserProject } from "@/lib/api/userProjects";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistProject } from "./persistProject";

vi.mock("@/lib/api/userProjects", () => ({ saveUserProject: vi.fn() }));

function emptyProject(): Project {
  return {
    id: projectId("p"),
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as Project;
}

beforeEach(() => vi.clearAllMocks());

describe("persistProject", () => {
  it("hasUser=true → saveUserProject", async () => {
    await persistProject(emptyProject(), true);
    expect(saveUserProject).toHaveBeenCalledTimes(1);
  });

  it("hasUser=false → no-op", async () => {
    await persistProject(emptyProject(), false);
    expect(saveUserProject).not.toHaveBeenCalled();
  });
});
