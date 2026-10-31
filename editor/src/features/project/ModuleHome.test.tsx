/**
 * A module's home (`?tab=` absent at the module's root): one block per place of the module
 * — the board, each collection, the settings screens, the data sources — and what the
 * module gives the server (its commands, its actions). Never a row per Document.
 */
import "@/i18n";
import { resetDocumentKinds } from "@/domain/documentKinds";
import type { Project, ProjectId } from "@/domain/types";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { resetDocumentCodecs } from "@/schema/documentCodecs";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import type { DocumentKindContribution, FrontendModule } from "@artisan/editor-sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { ModuleHome } from "./ModuleHome";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ serverId: "s1" }),
  Link: ({ children, params }: { children: ReactNode; params?: Record<string, string> }) => (
    <a href={`#${Object.values(params ?? {}).join("/")}`}>{children}</a>
  ),
}));

const PID = "conversations" as ProjectId;
const base = "plugins/Artisan/projects/conversations";

const conversationKind: DocumentKindContribution = {
  kind: "conversation",
  dir: "conversations",
  schemaVersion: "conversation/v1",
  projects: ["conversations"],
  collection: { labels: { en: "Conversations", fr: "Conversations" } },
  label: "Conversations",
  component: () => null,
  create: ({ id, projectId }) => ({ id, projectId }),
  parse: (src) => ({ doc: src as never, i18nKeys: {}, unsupported: [] }),
  serialize: () => ({}),
};

const conversations: FrontendModule = {
  id: "conversations",
  displayName: "Conversations",
  schemaVersion: "conversations/v1",
  sidebar: { icon: () => null, label: "Conversations", to: "/conversations" },
  routes: [],
  documents: [conversationKind],
};

function folder(): Project {
  return projectFromFiles(PID, {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr, en]\n",
    [`${base}/commands/conversations.yml`]: "schema: command/v1\nname: conversations\n",
    [`${base}/conversations/bruno.yml`]: "schema: conversation/v1\n",
    [`${base}/conversations/forgeron.yml`]: "schema: conversation/v1\n",
  });
}

beforeEach(() => {
  registerEditorModule(conversations);
  useProjectsStore.setState({
    openProjects: { projects: [folder()], projectOrder: [PID] },
  } as never);
  useServerScreensStore.setState({
    screens: [
      {
        id: "conversations:speakers",
        moduleId: "conversations",
        label: "Speakers",
        table: "data/speakers",
        projectId: "conversations",
      },
    ],
  } as never);
  useServerActionsStore.setState({
    actions: [
      { name: "conversations:start", args: [], primary: null, moduleId: "conversations" },
      { name: "open_menu", args: [], primary: null, moduleId: null },
    ],
  });
  navigate.mockReset();
});

afterEach(() => {
  clearRegistry();
  resetDocumentKinds();
  resetDocumentCodecs();
});

const project = () => useProjectsStore.getState().openProjects.projects[0]!;

describe("ModuleHome", () => {
  it("shows one block per place, with counts, not one row per Document", () => {
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const board = screen.getByTestId("module-home-board");
    // The command is on the board; the conversations, a collection, are not.
    expect(within(board).getByText("1")).toBeInTheDocument();
    const list = screen.getByTestId("module-home-collection-conversation");
    expect(within(list).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("bruno")).toBeNull();
    expect(screen.getByTestId("module-home-settings")).toHaveTextContent("Speakers");
  });

  it("puts a board with only commands after the lists, without its picture", () => {
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const blocks = screen.getAllByRole("listitem").map((li) => li.getAttribute("data-testid"));
    expect(blocks.indexOf("module-home-board")).toBeGreaterThan(
      blocks.indexOf("module-home-collection-conversation"),
    );
    expect(screen.queryByTestId("board-thumbnail")).toBeNull();
  });

  it("leads with a board of menus, wide, with its picture", () => {
    useProjectsStore.setState({
      openProjects: {
        projects: [
          projectFromFiles(PID, {
            [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr]\n",
            [`${base}/menus/main.yml`]: "schema: menu/v1\ntitle: Main\nsize: 27\n",
            [`${base}/conversations/bruno.yml`]: "schema: conversation/v1\n",
          }),
        ],
        projectOrder: [PID],
      },
    } as never);
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const blocks = screen.getAllByRole("listitem").map((li) => li.getAttribute("data-testid"));
    expect(blocks[0]).toBe("module-home-board");
    expect(screen.getByTestId("module-home-board").className).toContain("md:col-span-2");
    expect(screen.getByTestId("board-thumbnail")).toBeInTheDocument();
  });

  it('names a lone settings screen after itself, not "Settings" twice', () => {
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const settings = screen.getByTestId("module-home-settings");
    expect(within(settings).getByRole("heading")).toHaveTextContent("Speakers");
    expect(within(settings).getByRole("link")).toHaveTextContent(/^Open$|^Ouvrir$/);
  });

  it("opens the board from its block", () => {
    const onOpenBoard = vi.fn();
    render(<ModuleHome project={project()} onOpenBoard={onOpenBoard} />);
    fireEvent.click(within(screen.getByTestId("module-home-board")).getByRole("button"));
    expect(onOpenBoard).toHaveBeenCalledOnce();
  });

  it("lists what the module exposes: its commands and its own actions only", () => {
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const exposes = screen.getByTestId("module-home-exposes");
    expect(exposes).toHaveTextContent("/conversations");
    expect(exposes).toHaveTextContent("conversations:start");
    expect(exposes).not.toHaveTextContent("open_menu");
  });

  it("shows the module's own section above the blocks, with its project", () => {
    clearRegistry();
    registerEditorModule({
      ...conversations,
      home: ({ projectId }) => <p>Own section of {projectId}</p>,
    });
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    const own = screen.getByTestId("module-home-own");
    expect(own).toHaveTextContent("Own section of conversations");
    expect(
      own.compareDocumentPosition(screen.getByTestId("module-home-board")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves out a section that throws, and keeps the blocks", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    clearRegistry();
    registerEditorModule({
      ...conversations,
      home: () => {
        throw new Error("broken");
      },
    });
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    expect(screen.getByTestId("module-home-own")).toBeEmptyDOMElement();
    expect(screen.getByTestId("module-home-board")).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("leaves out the settings screen a collection already shows on its page", () => {
    useServerScreensStore.setState({
      screens: [
        {
          id: "conversations:speakers",
          moduleId: "conversations",
          label: "Speakers",
          table: "data/speakers",
          projectId: "conversations",
        },
      ],
    } as never);
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
    registerEditorModule({
      ...conversations,
      documents: [
        {
          ...conversationKind,
          collection: { ...conversationKind.collection!, screen: "conversations:speakers" },
        },
      ],
    });
    render(<ModuleHome project={project()} onOpenBoard={() => {}} />);
    expect(screen.queryByTestId("module-home-settings")).toBeNull();
  });
});
