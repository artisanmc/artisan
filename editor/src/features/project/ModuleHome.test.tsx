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
  useSearch: () => ({}),
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
  it("counts the store's version of the project, not the one the page opened with", () => {
    const opened = project();
    const docs = opened.documents as Record<string, unknown[]>;
    // The page opened before the module's kind arrived: no conversation yet.
    const before = { ...opened, documents: { ...docs, conversation: [] } } as Project;
    render(<ModuleHome project={before} />);
    // The kind's chip in the catalogue carries the store's count.
    expect(screen.getByTestId("catalogue-kind-conversation")).toHaveTextContent("2");
  });

  it("shows one block per place, with counts, not one row per Document in a block", () => {
    render(<ModuleHome project={project()} />);
    expect(screen.getByTestId("catalogue-kind-conversation")).toHaveTextContent("2");
    // A collection is the catalogue's, not a second block under Content.
    expect(screen.queryByTestId("module-home-collection-conversation")).toBeNull();
    expect(screen.getByTestId("catalogue-kind-settings")).toHaveTextContent("1");
  });

  it("lists the settings screens in the catalogue, not under Content", () => {
    render(<ModuleHome project={project()} />);
    expect(screen.queryByTestId("module-home-settings")).toBeNull();
    expect(screen.getByTestId("catalogue-settings-conversations:speakers")).toHaveTextContent(
      "Speakers",
    );
  });

  it("lists what the module exposes: its own actions only, no command", () => {
    render(<ModuleHome project={project()} />);
    const exposes = screen.getByTestId("module-home-exposes");
    expect(exposes).toHaveTextContent("conversations:start");
    expect(exposes).not.toHaveTextContent("/conversations");
    expect(exposes).not.toHaveTextContent("open_menu");
  });

  it("lists a collection's Documents in the catalogue, with their own filter", () => {
    render(<ModuleHome project={project()} />);
    expect(screen.getByTestId("catalogue-kind-conversation")).toHaveTextContent("2");
    expect(screen.getByTestId("catalogue-doc-conversation/bruno")).toBeInTheDocument();
  });

  it("shows no Content heading when the module has no block to put under it", () => {
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
    useServerScreensStore.setState({ screens: [] } as never);
    registerEditorModule({ ...conversations, documents: [] });
    render(<ModuleHome project={project()} />);
    expect(screen.queryByText(/^(Contenu|Content)$/)).toBeNull();
  });

  it("has no canvas or translations block: the header switch and the sidebar hold them", () => {
    render(<ModuleHome project={project()} />);
    expect(screen.queryByTestId("module-home-board")).toBeNull();
    expect(screen.queryByTestId("module-home-translations")).toBeNull();
  });

  it("shows the module's own section above the blocks, with its project", () => {
    clearRegistry();
    registerEditorModule({
      ...conversations,
      home: ({ projectId }) => <p>Own section of {projectId}</p>,
    });
    render(<ModuleHome project={project()} />);
    const own = screen.getByTestId("module-home-own");
    expect(own).toHaveTextContent("Own section of conversations");
    expect(
      own.compareDocumentPosition(screen.getByTestId("module-catalogue")) &
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
    render(<ModuleHome project={project()} />);
    expect(screen.getByTestId("module-home-own")).toBeEmptyDOMElement();
    expect(screen.getByTestId("module-catalogue")).toBeInTheDocument();
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
    render(<ModuleHome project={project()} />);
    expect(screen.queryByTestId("catalogue-settings-conversations:speakers")).toBeNull();
  });

  it("offers the captured items tool always, and lists the items in the catalogue when there are some", () => {
    const { rerender } = render(<ModuleHome project={project()} />);
    // Empty or not, the header chip is how a module learns to capture an item.
    expect(screen.getByTestId("module-home-tool-items")).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-kind-items")).toBeNull();
    useProjectsStore.setState({
      openProjects: {
        projects: [
          {
            ...project(),
            capturedItems: [{ id: "ci_1", name: "Key", stackYaml: "", display: {} }],
          },
        ],
        projectOrder: [PID],
      },
    } as never);
    rerender(<ModuleHome project={project()} />);
    expect(screen.getByTestId("catalogue-items-ci_1")).toHaveTextContent("Key");
    expect(screen.getByTestId("module-home-tool-items")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("catalogue-items-ci_1"));
    expect(navigate).toHaveBeenCalledOnce();
  });
});
