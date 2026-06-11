import { packId } from "@/domain/ids";
import { persistPack } from "@/features/pack/persistPack";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantChat } from "./AssistantChat";

vi.mock("@/features/pack/persistPack", () => ({ persistPack: vi.fn(async () => {}) }));

// Scripted SSE: two text chunks (must coalesce into ONE assistant entry),
// then a written menu, then done.
vi.mock("@/lib/api/assistant", () => ({
  openConversation: vi.fn(async () => "c1"),
  streamAssistant: vi.fn(async function* () {
    yield { type: "text", text: "Voici " };
    yield { type: "text", text: "le menu." };
    yield {
      type: "menu_written",
      menu: {
        schema: "menu/v1",
        id: "shop",
        title: [{ kind: "plain", value: { key: "k_title" } }],
        size: 27,
        layers: [
          {
            id: "l1",
            name: "default",
            elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }],
          },
        ],
      },
    };
    yield { type: "done", stopReason: "end_turn" };
  }),
  getConversation: vi.fn(async () => ({
    id: "c1",
    packId: "p",
    title: "Hi",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "salut" },
      { role: "assistant", content: "bonjour" },
    ],
    updatedAt: "2026-06-10T00:00:00Z",
  })),
}));

function setup() {
  useSessionStore.setState({ accessToken: "tok" } as never);
  useAccountStore.getState().setAccount({
    id: "a" as never,
    packs: [],
    packOrder: [],
  } as never);
  useAccountStore.getState().createPack({ id: "p" });
}

afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: null } as never);
});

describe("AssistantChat", () => {
  it("renders the transcript and composer", () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("streams assistant text and applies a written menu to the pack", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    // (a) streamed text appears, coalesced into a single line.
    await waitFor(() =>
      expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/Voici le menu\./),
    );

    // (b) the written menu is actually applied to the pack.
    await waitFor(() => {
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId("p"));
      expect(pack?.menus.find((m) => m.id === "shop")).toBeTruthy();
    });

    expect(screen.getByText(/(modifié|updated)\s*:?\s*shop/i)).toBeTruthy();

    // The generated menu is persisted immediately (not only via the debounced
    // auto-save) so a reload right after can't lose it.
    await waitFor(() => expect(persistPack).toHaveBeenCalled());
  });

  it("sends in user-auth mode: no session token but a logged-in user", async () => {
    setup();
    // Web-login mode: no editor-session token, auth rides the user cookie.
    useSessionStore.setState({ accessToken: null } as never);
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    render(<AssistantChat packId={packId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/Voici le menu\./),
    );
  });

  it("resumes a conversation: loads its transcript on mount", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} conversationId="c1" />);
    await waitFor(() => {
      const text = screen.getByTestId("assistant-transcript").textContent ?? "";
      expect(text).toMatch(/salut/);
      expect(text).toMatch(/bonjour/);
    });
  });

  it("lists dropped files with name and size", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    const panel = screen.getByTestId("assistant-panel");
    const content = "name: '&8Menu'\nsize: 54";
    const file = new File([content], "menu.yml", { type: "text/yaml" });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());
    expect(screen.getByText(`${content.length} B`)).toBeTruthy();
  });

  it("removes an attachment from the list", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    const panel = screen.getByTestId("assistant-panel");
    fireEvent.drop(panel, {
      dataTransfer: { files: [new File(["a: 1"], "menu.yml", { type: "text/yaml" })] },
    });
    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /menu\.yml/ }));
    await waitFor(() => expect(screen.queryByText("menu.yml")).toBeNull());
  });

  it("attaches files via the file picker button", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    const input = screen.getByTestId("assistant-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["kit: x"], "kits.yml", { type: "text/yaml" })] },
    });

    await waitFor(() => expect(screen.getByText("kits.yml")).toBeTruthy());
  });

  it("sends with attachments only: no text required", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    fireEvent.drop(screen.getByTestId("assistant-panel"), {
      dataTransfer: { files: [new File(["size: 54"], "menu.yml", { type: "text/yaml" })] },
    });
    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());

    const sendBtn = screen.getByText(/^(send|envoyer)$/i).closest("button");
    expect(sendBtn?.disabled).toBe(false);
    await userEvent.click(sendBtn as HTMLButtonElement);

    const { streamAssistant } = await import("@/lib/api/assistant");
    await waitFor(() =>
      expect(streamAssistant).toHaveBeenCalledWith(
        "tok",
        "c1",
        expect.objectContaining({ text: "", attachments: { "menu.yml": "size: 54" } }),
      ),
    );
    // The user bubble names the sent files instead of showing an empty message.
    expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/menu\.yml/);
  });

  it("keeps send disabled with neither text nor attachments", () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);
    const sendBtn = screen.getByText(/^(send|envoyer)$/i).closest("button");
    expect(sendBtn?.disabled).toBe(true);
  });

  it("sends the attached file contents with the message", async () => {
    setup();
    render(<AssistantChat packId={packId("p")} />);

    fireEvent.drop(screen.getByTestId("assistant-panel"), {
      dataTransfer: { files: [new File(["size: 54"], "menu.yml", { type: "text/yaml" })] },
    });
    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());

    await userEvent.type(screen.getByRole("textbox"), "migre ce fichier");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    const { streamAssistant } = await import("@/lib/api/assistant");
    await waitFor(() =>
      expect(streamAssistant).toHaveBeenCalledWith(
        "tok",
        "c1",
        expect.objectContaining({ attachments: { "menu.yml": "size: 54" } }),
      ),
    );
  });
});
