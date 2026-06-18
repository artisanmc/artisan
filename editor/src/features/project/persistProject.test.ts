import { projectId } from "@/domain/ids";
import type { Project } from "@/domain/types";
import { saveUserProject } from "@/lib/api/userProjects";
import { saveProject } from "@/lib/projectApi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistProject } from "./persistProject";

vi.mock("@/lib/projectApi", () => ({ saveProject: vi.fn() }));
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
    templates: [],
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
  it("session mode (token) → saveProject", async () => {
    await persistProject(emptyProject(), "tok", false);
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveUserProject).not.toHaveBeenCalled();
  });

  it("user-auth mode (no token, logged-in user) → saveUserProject", async () => {
    await persistProject(emptyProject(), null, true);
    expect(saveUserProject).toHaveBeenCalledTimes(1);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("no auth → no-op (neither endpoint called)", async () => {
    await persistProject(emptyProject(), null, false);
    expect(saveProject).not.toHaveBeenCalled();
    expect(saveUserProject).not.toHaveBeenCalled();
  });
});
