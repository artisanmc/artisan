/**
 * A module's Document kind, end to end on the host (ADR `extensible-document-kinds`,
 * lot 5): one `FrontendModule.documents` contribution and the registries, the selection,
 * the panel, the listings, the search, the texts, the edges, the board and the store all
 * see the kind without naming it.
 */
import "@/i18n";
import { documentChainSlots, documentLTextSites } from "@/domain/documentKindVisitors";
import { documentKindDef, listDocumentKinds, resetDocumentKinds } from "@/domain/documentKinds";
import { documentsOf } from "@/domain/documents";
import { rekeyProject, visitProjectStepChains } from "@/domain/i18nSites";
import type { I18nKey, LText, OpenProjects, Project, ProjectId, Step } from "@/domain/types";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { deriveEdges } from "@/features/canvas/deriveEdges";
import { nodeBox } from "@/features/canvas/menuLayout";
import { deriveServerGraph } from "@/features/canvas/serverGraph";
import { SelectionInspector } from "@/features/inspector/SelectionInspector";
import { DocumentGroups } from "@/features/project/ProjectDocumentTree";
import { selectionContext } from "@/features/project/selectionContext";
import { buildProjectDocuments, documentLabel } from "@/features/project/useProjectDocuments";
import { buildSearchIndex } from "@/features/search/searchIndex";
import { getText } from "@/lib/i18n";
import { documentCodec, resetDocumentCodecs } from "@/schema/documentCodecs";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import {
  type DocumentKindContribution,
  type FrontendModule,
  documentKindContribution,
  getModule,
  listDocumentKindContributions,
} from "@artisan/editor-sdk";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRegistry } from "../../packages/editor-sdk/src/contract/registry";
import { editorHost } from "./editorHost";
import { installDocumentKind, registerEditorModule } from "./moduleDocumentKinds";

const PID = "p1" as ProjectId;

interface Quest {
  id: string;
  projectId: ProjectId;
  title: LText;
  onComplete: Step[];
}

const questKind: DocumentKindContribution = {
  kind: "quest",
  dir: "quests",
  schemaVersion: "quest/v1",
  idPrefix: "quest_",
  label: "Quests",
  component: ({ document }) => <div data-testid="quest-view">{(document as Quest).id}</div>,
  title: (doc, { project, lang }) => getText(project as Project, (doc as Quest).title, lang),
  create: ({ id, projectId }) =>
    ({
      id,
      projectId: projectId as ProjectId,
      title: { key: "" as I18nKey },
      onComplete: [],
    }) as Quest,
  parse: (src) => ({ doc: src as unknown as Quest, i18nKeys: {}, unsupported: [] }),
  serialize: (doc) => ({ ...(doc as Quest) }),
  ltextSites: (doc) => {
    const q = doc as Quest;
    return [{ lText: q.title, key: `quests.${q.id}.title`, path: `${q.id}.title`, kind: "title" }];
  },
  chainSlots: (doc) => {
    const q = doc as Quest;
    return [{ name: "complete", steps: q.onComplete, prefix: `quests.${q.id}.complete` }];
  },
  board: { size: { width: 200, height: 80 }, summary: () => "quest" },
};

const questsModule: FrontendModule = {
  id: "quests",
  displayName: "Quests",
  schemaVersion: "quest/v1",
  sidebar: { icon: () => null, label: "Quests", to: "/quests" },
  routes: [],
  documents: [questKind],
};

const open = (name: string, id: string): Step => ({ kind: "action", action: { name, value: id } });

function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as never],
      command: [],
      dialog: [],
      quest: [
        {
          id: "quest_a",
          projectId: PID,
          title: { key: "old.a.title" as I18nKey },
          onComplete: [open("open_menu", "m1")],
        } as Quest,
        {
          id: "quest_b",
          projectId: PID,
          title: { key: "quests.quest_b.title" as I18nKey },
          onComplete: [open("quest_open", "quest_a")],
        } as Quest,
      ] as never[],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {
      ["old.a.title" as I18nKey]: { en: "Slay the dragon" },
      ["quests.quest_b.title" as I18nKey]: { en: "Rescue" },
    },
    defaultLang: "en",
    canvasLayout: { "menu/m1": { x: 0, y: 0 }, "quest/quest_a": { x: 300, y: 0 } } as never,
  } as Project;
}

describe("a module's Document kind on the host", () => {
  beforeEach(() => {
    registerEditorModule(questsModule);
    // A module action referencing the kind (R3), as the server would declare it.
    useServerActionsStore.setState({
      actions: [
        {
          name: "quest_open",
          args: [
            { name: "quest", type: { kind: "document_ref", document: "quest" }, required: true },
          ],
          primary: "quest",
          moduleId: "quests",
        },
      ],
    } as never);
    const openProjects: OpenProjects = {
      projects: [project()],
      projectOrder: [PID],
    };
    useProjectsStore.setState({ openProjects });
    useSelectionStore.getState().clear();
  });
  afterEach(() => {
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
    useServerActionsStore.setState({ actions: [] } as never);
    useServerDocumentKindsStore.setState({ kinds: [], status: "idle", loadedKey: null });
  });

  it("is flagged as not synchronised when the active server does not register it (W6)", () => {
    const core = {
      kind: "menu",
      dir: "menus",
      schemaVersions: ["menu/v1"],
      idPrefix: "m_",
      moduleId: null,
    };
    const quest = {
      kind: "quest",
      dir: "quests",
      schemaVersions: ["quest/v1"],
      idPrefix: "quest_",
      moduleId: "quests",
    };

    // The server answered without the kind: its rows in the tree and the creation dialog say so.
    useServerDocumentKindsStore.setState({ kinds: [core], status: "ready", loadedKey: "u:s" });
    const tree = render(<DocumentGroups project={project()} onOpen={() => {}} />);
    expect(screen.getAllByRole("img", { name: /Quests/ }).length).toBeGreaterThan(0);
    tree.unmount();
    const dialog = render(
      <NewDocumentDialog projectId={PID} kind="quest" open onOpenChange={() => {}} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Quests/);
    dialog.unmount();

    // The server registers it: nothing is flagged.
    useServerDocumentKindsStore.setState({
      kinds: [core, quest],
      status: "ready",
      loadedKey: "u:s",
    });
    render(<DocumentGroups project={project()} onOpen={() => {}} />);
    expect(screen.queryByRole("img", { name: /Quests/ })).toBeNull();
    render(<NewDocumentDialog projectId={PID} kind="quest" open onOpenChange={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("enters the kind table, the codecs and the visitors; registering twice is a no-op", () => {
    expect(getModule("quests")).toBeDefined();
    expect(listDocumentKindContributions().map((c) => c.kind)).toContain("quest");
    expect(documentKindDef("quest")).toMatchObject({ dir: "quests", idPrefix: "quest_" });
    expect(
      listDocumentKinds()
        .map((k) => k.kind)
        .slice(-1),
    ).toEqual(["quest"]);
    expect(documentCodec("quest").serialize({ id: "x" } as never, project())).toEqual({ id: "x" });
    const [a] = documentsOf(project(), "quest");
    expect([...documentLTextSites("quest", a!)].map((s) => s.key)).toEqual([
      "quests.quest_a.title",
    ]);
    expect([...documentChainSlots("quest", a!)].map((s) => s.name)).toEqual(["complete"]);
    expect(() => registerEditorModule(questsModule)).not.toThrow();
  });

  it("refuses a contribution that redefines a registered kind's folder", () => {
    expect(() => installDocumentKind({ ...questKind, dir: "elsewhere" })).toThrow(/quests/);
  });

  it("is what the selection designates, and what the Properties panel renders", () => {
    const ctx = selectionContext(project(), new Set(["quest/quest_a"]), null);
    expect(ctx).toEqual({ kind: "document", documentKind: "quest", id: "quest_a" });

    useSelectionStore.getState().set(["quest/quest_a"]);
    render(<SelectionInspector projectId={PID} />);
    expect(screen.getByTestId("quest-view").textContent).toBe("quest_a");
  });

  it("is listed, labelled and searchable through its contribution", () => {
    const groups = buildProjectDocuments(project(), "en");
    const quests = groups.find((g) => g.type === "quest")!;
    // Listed by id (no `listByTitle`), titled through `title`.
    expect(quests.items.map((i) => i.label)).toEqual(["quest_a", "quest_b"]);
    expect(documentLabel(project(), "quest_a", "en")).toBe("Slay the dragon");
    expect(documentKindContribution("quest")?.label).toBe("Quests");

    const entry = buildSearchIndex(project(), "en").find((e) => e.id === "quest:quest_a");
    expect(entry).toMatchObject({ group: "quest", label: "Slay the dragon" });
  });

  it("gets its edges from its chain slots, on the project board and the server board", () => {
    const edges = deriveEdges(project());
    const toMenu = edges.find((e) => e.source === "quest/quest_a" && e.target === "menu/m1");
    expect(toMenu?.triggers).toEqual([{ kind: "chain", documentId: "quest_a", slot: "complete" }]);
    const toQuest = edges.find((e) => e.source === "quest/quest_b" && e.target === "quest/quest_a");
    expect(toQuest).toBeDefined();

    const graph = deriveServerGraph([project()]);
    expect(graph.nodes.find((n) => n.docId === "quest_a")).toMatchObject({
      kind: "quest",
      width: 200,
      height: 80,
    });
    expect(graph.edges.map((e) => e.id)).toContain("p1/quest/quest_b->p1/quest/quest_a");
    expect(nodeBox(project(), "quest/quest_a", { "quest/quest_a": { x: 1, y: 2 } })).toEqual({
      x: 1,
      y: 2,
      width: 200,
      height: 80,
    });
  });

  it("lists its parts on the board, each selectable apart from the Document (SDK 1.2)", () => {
    const groupKind: DocumentKindContribution = {
      ...questKind,
      kind: "chapter",
      dir: "chapters",
      schemaVersion: "chapter/v1",
      idPrefix: "chapter_",
      component: ({ item }) => <div data-testid="chapter-view">{item ?? "group"}</div>,
      board: {
        size: { width: 220, height: 48 },
        items: (doc) =>
          (doc as { parts: string[] }).parts.map((id) => ({ id, label: id.toUpperCase() })),
      },
    };
    registerEditorModule({ ...questsModule, id: "chapters", documents: [groupKind] });
    const p = project();
    (p.documents as Record<string, unknown[]>).chapter = [
      { id: "chapter_1", projectId: PID, title: { key: "" }, onComplete: [], parts: ["q1", "q2"] },
    ];
    useProjectsStore.setState({ openProjects: { projects: [p], projectOrder: [PID] } });

    // Header plus one row per part: the node grows, its width stays.
    expect(nodeBox(p, "chapter/chapter_1", { "chapter/chapter_1": { x: 0, y: 0 } })).toMatchObject({
      width: 220,
      height: 46 + 2 * 24 + 6,
    });

    // A part is selected scoped by its Document; the view receives it as `item`.
    editorHost.selectDocumentItem({ documentId: "chapter_1", item: "q2" });
    const s = useSelectionStore.getState();
    expect(selectionContext(p, s.ids, s.menuId)).toEqual({
      kind: "document",
      documentKind: "chapter",
      id: "chapter_1",
      item: "q2",
    });
    const view = render(<SelectionInspector projectId={PID} />);
    expect(screen.getByTestId("chapter-view").textContent).toBe("q2");
    view.unmount();

    // Without an item, the Document itself is selected again.
    editorHost.selectDocumentItem({ documentId: "chapter_1", item: null });
    render(<SelectionInspector projectId={PID} />);
    expect(screen.getByTestId("chapter-view").textContent).toBe("group");
  });

  it("has its texts rekeyed and its chains addressed like a core kind", () => {
    const p = project();
    rekeyProject(p);
    const [a] = documentsOf(p, "quest") as unknown as Quest[];
    expect(a!.title.key).toBe("quests.quest_a.title");
    expect(p.i18nKeys["quests.quest_a.title" as I18nKey]).toEqual({ en: "Slay the dragon" });
    expect(p.i18nKeys["old.a.title" as I18nKey]).toBeUndefined();
    const prefixes = [...visitProjectStepChains(p)].map((c) => c.prefix);
    expect(prefixes).toContain("quests.quest_a.complete");
  });

  it("is created from the contribution's seed, with its texts minted", () => {
    const id = useProjectsStore
      .getState()
      .createDocument({ projectId: PID, kind: "quest", id: "quest_c", position: { x: 5, y: 6 } });
    expect(id).toBe("quest_c");
    const p = useProjectsStore.getState().openProjects.projects[0]!;
    const c = (documentsOf(p, "quest") as unknown as Quest[]).find((q) => q.id === "quest_c")!;
    expect(c.title.key).toBe("quests.quest_c.title");
    expect(p.i18nKeys["quests.quest_c.title" as I18nKey]).toEqual({ en: "" });
    expect((p.canvasLayout as Record<string, unknown>)["quest/quest_c"]).toEqual({ x: 5, y: 6 });
    expect(() =>
      useProjectsStore.getState().createDocument({ projectId: PID, kind: "quest", id: "quest_c" }),
    ).toThrow(/already exists/);
  });

  it("is renamed with its texts, its layout and every reference to it", () => {
    useProjectsStore
      .getState()
      .setDocumentId({ projectId: PID, kind: "quest", oldId: "quest_a", newId: "quest_z" });
    const p = useProjectsStore.getState().openProjects.projects[0]!;
    const quests = documentsOf(p, "quest") as unknown as Quest[];
    const z = quests.find((q) => q.id === "quest_z")!;
    expect(z.title.key).toBe("quests.quest_z.title");
    expect(p.i18nKeys["quests.quest_z.title" as I18nKey]).toEqual({ en: "Slay the dragon" });
    expect((p.canvasLayout as Record<string, unknown>)["quest/quest_z"]).toEqual({ x: 300, y: 0 });
    const b = quests.find((q) => q.id === "quest_b")!;
    expect(b.onComplete[0]).toEqual(open("quest_open", "quest_z"));
    expect(useProjectDraftStore.getState().pendingRenames[PID]).toEqual([
      { from: "quests/quest_a.yml", to: "quests/quest_z.yml" },
    ]);
  });
});
