import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentTree } from "./ProjectDocumentTree";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...mod,
    Link: ({ children, ...rest }: { children: React.ReactNode }) => (
      <a {...(rest as object)}>{children}</a>
    ),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
  };
});

const PID = "daily" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "daily",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: { menu: [], command: [], dialog: [] },
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

const command = (name: string) => ({
  id: `daily:${name}`,
  moduleId: "daily",
  name,
  aliases: [],
  permission: null,
  description: {},
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
});

beforeEach(() => {
  useProjectsStore.setState({
    openProjects: { projects: [project()], projectOrder: [PID] },
  } as never);
  useSystemCommandsStore.setState({
    serverId: "srv",
    status: "ready",
    commands: [command("daily"), command("dailyadmin")],
    folders: [{ folder: "daily", ownerModule: "daily" }],
    overrides: {},
  } as never);
});

describe("module commands in the folder's tree", () => {
  it("lists the module's commands with the folder's own, in one list", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    expect(screen.getAllByText("/daily")).toHaveLength(1);
    expect(screen.getAllByText("/dailyadmin")).toHaveLength(1);
    expect(screen.getAllByRole("list", { name: /command/i })).toHaveLength(1);
  });

  it("opens a module command like a Document, on the board", () => {
    const onOpen = vi.fn();
    render(<ProjectDocumentTree projectId={PID} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("/dailyadmin"));
    expect(onOpen).toHaveBeenCalledWith("daily:dailyadmin");
  });
});
