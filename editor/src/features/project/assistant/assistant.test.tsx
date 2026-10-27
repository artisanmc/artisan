import { OPEN_DEPLOY_REVIEW } from "@/features/project/ProjectHistory";
import { ApiError } from "@/lib/api/client";
import { ASSISTANT_WIDTH, useAssistantPanelStore } from "@/state/assistantPanelStore";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantButton } from "./AssistantButton";
import { AssistantDock, OPEN_DRAFTS } from "./AssistantPanel";
import { resetAiStatus } from "./useAssistant";

const api = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  createAiConversation: vi.fn(),
  readAiConversation: vi.fn(),
  sendAiMessage: vi.fn(),
}));
vi.mock("@/lib/api/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/ai")>()),
  ...api,
}));

const conversation = (events: unknown[], running = false) => ({
  id: "c1",
  project: "u-local.shop",
  title: null,
  running,
  createdAt: "",
  lastActive: "",
  inputTokens: 0,
  outputTokens: 0,
  events,
});

const Assistant = () => (
  <>
    <AssistantButton />
    <AssistantDock projectId="u-local.shop" />
  </>
);

describe("assistant", () => {
  beforeEach(() => {
    useAssistantPanelStore.setState({ open: false, width: ASSISTANT_WIDTH.default });
    vi.clearAllMocks();
    resetAiStatus();
    api.getAiStatus.mockResolvedValue({ enabled: true, model: "claude-opus-5-5", canUse: true });
    api.createAiConversation.mockResolvedValue(conversation([]));
    api.sendAiMessage.mockResolvedValue(undefined);
  });

  it("is not offered without an assistant on the hub, or without edit", async () => {
    api.getAiStatus.mockResolvedValueOnce({ enabled: false, model: null, canUse: false });
    const { unmount } = render(<Assistant />);
    await act(async () => {});
    expect(screen.queryByTestId("open-assistant")).toBeNull();
    expect(screen.queryByTestId("assistant-dock")).toBeNull();
    unmount();
    resetAiStatus();
    api.getAiStatus.mockResolvedValueOnce({ enabled: true, model: "m", canUse: false });
    render(<Assistant />);
    await act(async () => {});
    expect(screen.queryByTestId("open-assistant")).toBeNull();
  });

  it("sends a message for the open project, shows each step, and opens the draft in Drafts", async () => {
    api.readAiConversation.mockResolvedValueOnce(
      conversation([
        { seq: 0, type: "user", text: "Un menu VIP" },
        { seq: 1, type: "tool", name: "read_document", path: "menus/shop.yml", ok: true },
        {
          seq: 2,
          type: "tool",
          name: "start_draft",
          ok: true,
          draft: { project: "u-local.shop", id: "d1", name: "IA : VIP" },
        },
        {
          seq: 3,
          type: "tool",
          name: "write_document",
          path: "menus/vip.yml",
          ok: false,
          problems: 2,
        },
        { seq: 4, type: "text", text: "Le brouillon est prêt." },
        { seq: 5, type: "done", inputTokens: 10, outputTokens: 5 },
      ]),
    );
    render(<Assistant />);
    fireEvent.click(await screen.findByTestId("open-assistant"));
    expect(screen.getByText(/Tourne sur le compte claude-opus-5-5/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "Un menu VIP" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByText("Le brouillon est prêt.")).toBeTruthy();
    expect(api.createAiConversation).toHaveBeenCalledWith("u-local.shop");
    expect(api.sendAiMessage).toHaveBeenCalledWith("c1", "Un menu VIP");
    expect(screen.getByText("A lu menus/shop.yml")).toBeTruthy();
    expect(screen.getByText("A écrit menus/vip.yml")).toBeTruthy();
    expect(screen.getByText("· 2 problèmes")).toBeTruthy();

    const opened = vi.fn();
    window.addEventListener(OPEN_DRAFTS, opened);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir « IA : VIP » dans Brouillons" }));
    expect(opened).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_DRAFTS, opened);

    const review = vi.fn();
    window.addEventListener(OPEN_DEPLOY_REVIEW, review);
    fireEvent.click(screen.getByRole("button", { name: "Revoir et déployer son brouillon" }));
    expect((review.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      projectId: "u-local.shop",
      preselect: ["d1"],
    });
    window.removeEventListener(OPEN_DEPLOY_REVIEW, review);
  });

  it("renders the model's Markdown: tables, bold, code, and no raw HTML", async () => {
    api.readAiConversation.mockResolvedValueOnce(
      conversation([
        { seq: 0, type: "user", text: "liste les menus" },
        {
          seq: 1,
          type: "text",
          text: "Les menus de **auctions** :\n\n| id | fichier |\n|---|---|\n| `ah_main` | `menus/ah_main.yml` |\n\n<img src=x onerror=alert(1)>",
        },
        { seq: 2, type: "done", inputTokens: 1, outputTokens: 1 },
      ]),
    );
    render(<Assistant />);
    fireEvent.click(await screen.findByTestId("open-assistant"));
    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "liste les menus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "fichier" })).toBeTruthy();
    expect(screen.getByText("auctions").tagName).toBe("STRONG");
    expect(screen.getByText("ah_main").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("widens and narrows from its left edge, within bounds, and remembers the width", async () => {
    useAssistantPanelStore.setState({ width: ASSISTANT_WIDTH.default });
    render(<Assistant />);
    fireEvent.click(await screen.findByTestId("open-assistant"));
    const handle = screen.getByRole("separator", { name: "Redimensionner l’assistant" });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(useAssistantPanelStore.getState().width).toBe(ASSISTANT_WIDTH.default + 16);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(useAssistantPanelStore.getState().width).toBe(ASSISTANT_WIDTH.default - 32);
    fireEvent.keyDown(handle, { key: "End" });
    expect(useAssistantPanelStore.getState().width).toBe(ASSISTANT_WIDTH.max);
    useAssistantPanelStore.getState().setWidth(10_000);
    expect(useAssistantPanelStore.getState().width).toBe(ASSISTANT_WIDTH.max);
    fireEvent.doubleClick(handle);
    expect(useAssistantPanelStore.getState().width).toBe(ASSISTANT_WIDTH.default);
    expect(localStorage.getItem("artisan-assistant-panel")).toContain(`${ASSISTANT_WIDTH.default}`);
  });

  it("docks beside the page, closes without losing the conversation, and reopens", async () => {
    api.readAiConversation.mockResolvedValueOnce(
      conversation([
        { seq: 0, type: "user", text: "bonjour" },
        { seq: 1, type: "text", text: "Salut." },
        { seq: 2, type: "done", inputTokens: 1, outputTokens: 1 },
      ]),
    );
    render(<Assistant />);
    const toggle = await screen.findByTestId("open-assistant");
    expect(screen.getByTestId("assistant-dock").hidden).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByTestId("assistant-dock").hidden).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "bonjour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("Salut.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fermer l’assistant" }));
    expect(screen.getByTestId("assistant-dock").hidden).toBe(true);
    expect(useAssistantPanelStore.getState().open).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByText("Salut.")).toBeTruthy();
  });

  it("polls while the assistant works, asking only for new events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.readAiConversation
      .mockResolvedValueOnce(conversation([{ seq: 0, type: "user", text: "salut" }], true))
      .mockResolvedValueOnce(conversation([{ seq: 1, type: "text", text: "Bonjour !" }]));
    render(<Assistant />);
    fireEvent.click(await screen.findByTestId("open-assistant"));
    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "salut" },
    });
    fireEvent.keyDown(screen.getByLabelText("Demande à l’assistant…"), { key: "Enter" });
    expect(await screen.findByText("En cours…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(screen.getByText("Bonjour !")).toBeTruthy());
    expect(api.readAiConversation).toHaveBeenNthCalledWith(1, "c1", 0);
    expect(api.readAiConversation).toHaveBeenNthCalledWith(2, "c1", 1);
    expect(screen.queryByText("En cours…")).toBeNull();
    vi.useRealTimers();
  });

  it("says why a message could not be answered", async () => {
    api.readAiConversation.mockResolvedValueOnce(
      conversation([
        { seq: 0, type: "user", text: "hi" },
        { seq: 1, type: "error", code: "ai_key_refused" },
      ]),
    );
    render(<Assistant />);
    fireEvent.click(await screen.findByTestId("open-assistant"));
    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText(/refuse la clé d’API du serveur/)).toBeTruthy();

    api.sendAiMessage.mockRejectedValueOnce(new ApiError("ai_busy", 409));
    fireEvent.change(screen.getByLabelText("Demande à l’assistant…"), {
      target: { value: "encore" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("L’assistant répond encore.")).toBeTruthy();
  });
});
