import type { Project } from "@/domain/types";
import { resetAiStatus, resetConversations } from "@/features/project/assistant/useAssistant";
import type { AiEvent } from "@/lib/api/ai";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPage } from "./AssistantPage";
import { menusOf } from "@/domain/documents";
import { artifactsOf, conversationDrafts, menuIdOfPath, projectFromDraftTree } from "./artifacts";

const api = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  createAiConversation: vi.fn(),
  readAiConversation: vi.fn(),
  sendAiMessage: vi.fn(),
  listAiConversations: vi.fn(),
  readDraft: vi.fn(),
  loadOtherDrafts: vi.fn(),
}));
vi.mock("@/lib/api/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/ai")>()),
  getAiStatus: api.getAiStatus,
  createAiConversation: api.createAiConversation,
  readAiConversation: api.readAiConversation,
  sendAiMessage: api.sendAiMessage,
  listAiConversations: api.listAiConversations,
}));
vi.mock("@/lib/api/projectDrafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/projectDrafts")>()),
  readDraft: api.readDraft,
}));
vi.mock("@/features/project/publish/otherDrafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/project/publish/otherDrafts")>()),
  loadOtherDrafts: api.loadOtherDrafts,
  checkOtherDraft: () => Promise.resolve([]),
}));
vi.mock("@/features/project/useServerProjects", () => ({
  useServerProjects: () => ({
    projects: [
      { id: "u-local.shop", name: "Store", diskId: "shop", serverKeyId: "u-local" } as Project,
    ],
    probes: null,
    listing: "ready",
    settled: true,
    done: 1,
    total: 1,
    failedCount: 0,
  }),
}));
vi.mock("@/features/play/MenuPlayPreview", () => ({
  MenuPlayPreview: (props: { projects: Project[]; projectId: string; menuId: string }) => (
    <div data-testid="menu-preview">
      {props.projectId}/{props.menuId}:{" "}
      {menusOf(props.projects.find((p) => p.id === props.projectId))
        .map((m) => m.id)
        .join(",")}
    </div>
  ),
}));
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")),
  useParams: () => ({ serverId: "u-local" }),
  useNavigate: () => vi.fn(),
}));

const summary = (id: string, title: string | null, server: string | null = "u-local") => ({
  id,
  project: null,
  server,
  title,
  running: false,
  createdAt: "",
  lastActive: "",
  inputTokens: 0,
  outputTokens: 0,
});

const wrote: AiEvent[] = [
  { seq: 0, type: "user", text: "Une boutique et une commande /shop" },
  {
    seq: 1,
    type: "tool",
    name: "start_draft",
    ok: true,
    draft: { project: "u-local.shop", id: "d1", name: "IA : boutique" },
  },
  {
    seq: 2,
    type: "tool",
    name: "write_document",
    path: "commands/shop.yml",
    ok: true,
    draft: { project: "u-local.shop", id: "d1" },
  },
  {
    seq: 3,
    type: "tool",
    name: "write_document",
    path: "menus/broken.yml",
    ok: false,
    problems: 1,
  },
  { seq: 4, type: "text", text: "C’est prêt." },
  { seq: 5, type: "done", inputTokens: 1, outputTokens: 1 },
];

describe("the conversation's files", () => {
  it("lists each file written once, the last written first, and not the refused ones", () => {
    const events: AiEvent[] = [
      ...wrote,
      {
        seq: 6,
        type: "tool",
        name: "write_document",
        path: "menus/vip.yml",
        ok: true,
        draft: { project: "u-local.vip", id: "d2" },
      },
      {
        seq: 7,
        type: "tool",
        name: "write_document",
        path: "commands/shop.yml",
        ok: true,
        draft: { project: "u-local.shop", id: "d1" },
      },
    ];
    expect(artifactsOf(events).map((a) => [a.project, a.path, a.draftName, a.seq])).toEqual([
      ["u-local.shop", "commands/shop.yml", "IA : boutique", 7],
      ["u-local.vip", "menus/vip.yml", null, 6],
    ]);
    expect(conversationDrafts(events)).toEqual(["d1", "d2"]);
  });

  it("knows a menu by its folder, themed or not", () => {
    expect(menuIdOfPath("menus/shop.yml")).toBe("shop");
    expect(menuIdOfPath("vip/menus/hub.yaml")).toBe("hub");
    expect(menuIdOfPath("commands/shop.yml")).toBeNull();
    expect(menuIdOfPath("menus/readme.txt")).toBeNull();
  });
});

describe("a draft's version of a Project", () => {
  it("parses the draft's files under the Project's own identity", () => {
    const base = {
      id: "u-local.shop",
      name: "Store",
      diskId: "shop",
      serverKeyId: "u-local",
    } as Project;
    const drafted = projectFromDraftTree(base, {
      "artisan-module.yml": "schema: module/v1\n",
      "menus/vip.yml": "schema: menu/v1\nsize: 27\n",
    });
    expect(drafted.id).toBe("u-local.shop");
    expect(drafted.name).toBe("Store");
    expect(menusOf(drafted).map((m) => m.id)).toEqual(["vip"]);
  });
});

describe("the Assistant tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    resetConversations();
    api.getAiStatus.mockResolvedValue({ enabled: true, model: "deepseek-chat", canUse: true });
    api.listAiConversations.mockResolvedValue([
      summary("c1", "Une boutique et une commande /shop"),
      summary("c2", "Sur un autre serveur", "u-other"),
    ]);
    api.createAiConversation.mockResolvedValue(summary("c1", null));
    api.sendAiMessage.mockResolvedValue(undefined);
    api.readAiConversation.mockResolvedValue({ ...summary("c1", null), events: wrote });
    api.readDraft.mockResolvedValue({
      id: "d1",
      projectId: "u-local.shop",
      name: "IA : boutique",
      snapshot: {
        baseline: { "commands/shop.yml": "name: shop\n" },
        tree: { "commands/shop.yml": "name: shop\naliases: [boutique]\n" },
        at: 0,
      },
    });
    api.loadOtherDrafts.mockResolvedValue([]);
  });

  it("starts a conversation on the server and shows each file it wrote, in its Project", async () => {
    render(<AssistantPage />);
    const list = await screen.findByRole("navigation", { name: "Conversations" });
    expect(await within(list).findByText("Une boutique et une commande /shop")).toBeTruthy();
    expect(within(list).queryByText("Sur un autre serveur")).toBeNull();
    expect(screen.getByText(/Tourne sur le modèle deepseek-chat/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "Une boutique et une commande /shop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("C’est prêt.")).toBeTruthy();
    expect(api.createAiConversation).toHaveBeenCalledWith({ project: null, server: "u-local" });

    const card = await screen.findByRole("article", { name: "Store · commands/shop.yml" });
    expect(within(card).getByText("Brouillon « IA : boutique »")).toBeTruthy();
    expect(await within(card).findByText("+1")).toBeTruthy();
    expect(within(card).getByText(/aliases: \[boutique\]/)).toBeTruthy();
    // A command has no visual view yet: no toggle.
    expect(within(card).queryByRole("group", { name: "Affichage" })).toBeNull();
    expect(screen.getAllByTestId("assistant-artifact")).toHaveLength(1);
    expect(api.readDraft).toHaveBeenCalledWith("u-local.shop", "d1");
  });

  it("shows a menu it wrote as the game would, and as YAML against the server", async () => {
    api.readAiConversation.mockResolvedValue({
      ...summary("c1", null),
      events: [
        { seq: 0, type: "user", text: "menu vip" },
        {
          seq: 1,
          type: "tool",
          name: "write_document",
          path: "menus/vip.yml",
          ok: true,
          draft: { project: "u-local.shop", id: "d1", name: "IA : VIP" },
        },
        { seq: 2, type: "done", inputTokens: 1, outputTokens: 1 },
      ],
    });
    api.readDraft.mockResolvedValue({
      id: "d1",
      projectId: "u-local.shop",
      name: "IA : VIP",
      snapshot: {
        baseline: { "artisan-module.yml": "schema: module/v1\n" },
        tree: {
          "artisan-module.yml": "schema: module/v1\n",
          "menus/vip.yml": "schema: menu/v1\nsize: 27\n",
        },
        at: 0,
      },
    });
    render(<AssistantPage />);
    fireEvent.change(await screen.findByLabelText("Demande à l’assistant…"), {
      target: { value: "menu vip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const card = await screen.findByRole("article", { name: "Store · menus/vip.yml" });
    expect(await within(card).findByTestId("menu-preview")).toHaveTextContent(
      "u-local.shop/vip: vip",
    );
    expect(within(card).getByText("Nouveau fichier")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "YAML" }));
    expect(within(card).queryByTestId("menu-preview")).toBeNull();
    expect(within(card).getByText(/size: 27/)).toBeTruthy();
  });

  it("opens Deploy's review with every draft of the conversation picked", async () => {
    render(<AssistantPage />);
    fireEvent.change(await screen.findByLabelText("Demande à l’assistant…"), {
      target: { value: "go" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoir et déployer son brouillon" }),
    );
    await act(async () => {});
    expect(api.loadOtherDrafts).toHaveBeenCalledOnce();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("says how to turn the assistant on when it is off", async () => {
    api.getAiStatus.mockResolvedValue({ enabled: false, model: null, canUse: false });
    render(<AssistantPage />);
    expect(await screen.findByText(/Un admin l’active dans Réglages → Assistant/)).toBeTruthy();
    expect(screen.queryByLabelText("Demande à l’assistant…")).toBeNull();
  });
});
