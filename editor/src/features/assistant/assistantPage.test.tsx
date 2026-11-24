import { menusOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { resetDraftImages } from "@/features/project/assistant/DraftImage";
import { resetAiStatus, resetConversations } from "@/features/project/assistant/useAssistant";
import type { AiEvent } from "@/lib/api/ai";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPage } from "./AssistantPage";
import { artifactsOf, conversationDrafts, menuIdOfPath, projectFromDraftTree } from "./artifacts";

const api = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  createAiConversation: vi.fn(),
  readAiConversation: vi.fn(),
  sendAiMessage: vi.fn(),
  listAiConversations: vi.fn(),
  readDraft: vi.fn(),
  readDraftBlob: vi.fn(),
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
  readDraftBlob: api.readDraftBlob,
}));
vi.mock("@/features/project/publish/otherDrafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/project/publish/otherDrafts")>()),
  loadOtherDrafts: api.loadOtherDrafts,
  checkOtherDraft: () => Promise.resolve({ problems: [], impacts: [] }),
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
      // An image it drew is a file of the draft too; one drawn before the event named its file is not listed.
      {
        seq: 8,
        type: "tool",
        name: "write_image",
        path: "assets/textures/buy.png",
        image: "abc",
        ok: true,
        draft: { project: "u-local.shop", id: "d1" },
      },
      {
        seq: 9,
        type: "tool",
        name: "write_image",
        ok: true,
        draft: { project: "u-local.shop", id: "d1" },
      },
    ];
    expect(artifactsOf(events).map((a) => [a.project, a.path, a.draftName, a.seq])).toEqual([
      ["u-local.shop", "assets/textures/buy.png", "IA : boutique", 8],
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

  it("shows the text and the file the model is writing, then the file once written", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.readAiConversation.mockResolvedValueOnce({
      ...summary("c1", null),
      running: true,
      events: [{ seq: 0, type: "user", text: "Une boutique" }],
      live: {
        text: "Je crée la commande",
        tools: [
          {
            id: "t1",
            name: "write_document",
            input:
              '{"project":"u-local.shop","path":"commands/shop.yml","content":"name: shop\\nali',
          },
        ],
      },
    });
    render(<AssistantPage />);
    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "Une boutique" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("Je crée la commande")).toBeTruthy();
    const card = await screen.findByTestId("assistant-live-artifact");
    expect(card.getAttribute("aria-label")).toBe("Écrit commands/shop.yml");
    expect(within(card).getByText("Store ·", { exact: false })).toBeTruthy();
    expect(card.querySelector("pre")?.textContent).toBe("name: shop\nali");
    expect(screen.getByText("Écrit commands/shop.yml")).toBeTruthy();
    expect(screen.getByText("2 lignes")).toBeTruthy();

    // The next read has the turn done: the live card gives way to the file's own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(await screen.findByText("C’est prêt.")).toBeTruthy();
    expect(screen.queryByTestId("assistant-live-artifact")).toBeNull();
    expect(screen.queryByTestId("assistant-live")).toBeNull();
    expect(await screen.findByRole("article", { name: "Store · commands/shop.yml" })).toBeTruthy();
    vi.useRealTimers();
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

  it("shows an image it drew, in the conversation and as a card, read from the draft", async () => {
    api.readAiConversation.mockResolvedValue({
      ...summary("c1", null),
      events: [
        { seq: 0, type: "user", text: "un bouton" },
        {
          seq: 1,
          type: "tool",
          name: "write_image",
          path: "assets/textures/buy.png",
          image: "h-new",
          ok: true,
          draft: { project: "u-local.shop", id: "d-img", name: "IA : bouton" },
        },
        { seq: 2, type: "done", inputTokens: 1, outputTokens: 1 },
      ],
    });
    // Its own draft: a draft's read is kept by draft and version, across the tests of this file.
    api.readDraft.mockResolvedValue({
      id: "d-img",
      projectId: "u-local.shop",
      name: "IA : bouton",
      snapshot: {
        baseline: {},
        tree: { "assets/textures/buy.yml": "width: 54\nheight: 18\n" },
        binaryBaseline: { "assets/textures/buy.png": { hash: "h-old", size: 90 } },
        binaryTree: { "assets/textures/buy.png": { hash: "h-new", size: 120 } },
        at: 0,
      },
    });
    api.readDraftBlob.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const made = vi.fn(() => "blob:buy");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: made }));
    resetDraftImages();
    render(<AssistantPage />);
    fireEvent.change(await screen.findByLabelText("Demande à l’assistant…"), {
      target: { value: "un bouton" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    // In the conversation, under the line that says what it drew.
    expect(await screen.findByText("A dessiné assets/textures/buy.png")).toBeTruthy();
    const card = await screen.findByRole("article", { name: "Store · assets/textures/buy.png" });
    expect(await within(card).findByText("Modifiée")).toBeTruthy();
    // Not shown until its size is known: found by its text, not by its role.
    const pictures = await screen.findAllByAltText("assets/textures/buy.png");
    expect(pictures).toHaveLength(2);
    expect(pictures[0]).toHaveAttribute("src", "blob:buy");
    // The same content is read once for both.
    expect(api.readDraftBlob).toHaveBeenCalledTimes(1);
    expect(api.readDraftBlob).toHaveBeenCalledWith("u-local.shop", "d-img", "h-new");
    // Its size shows once the picture has loaded, at a whole number of times its size.
    const shown = within(card).getByAltText("assets/textures/buy.png");
    Object.defineProperties(shown, {
      naturalWidth: { value: 54 },
      naturalHeight: { value: 18 },
    });
    fireEvent.load(shown);
    expect(within(card).getByText("54 × 18")).toBeTruthy();
    expect(shown).toHaveAttribute("width", String(54 * 5));
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
