import { projectId } from "@/domain/ids";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantChat } from "./AssistantChat";

// Scripted SSE: two text chunks (must coalesce into ONE assistant entry),
// then a written menu, then done.
vi.mock("@/lib/api/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/assistant")>()),
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
            elements: [{ id: "e1", positions: "0", material: "STONE" }],
          },
        ],
      },
    };
    yield { type: "done", stopReason: "end_turn" };
  }),
  getConversation: vi.fn(async () => ({
    id: "c1",
    projectId: "p",
    title: "Hi",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "salut" },
      { role: "assistant", content: "bonjour" },
    ],
    updatedAt: "2026-06-10T00:00:00Z",
  })),
}));

vi.mock("@/lib/api/importSources", () => ({
  listImportSources: vi.fn(async () => ({
    ok: true,
    sources: [
      {
        id: "zmenu",
        label: "zMenu",
        files: [
          { path: "categories/blocks.yml", size: 20 },
          { path: "shop.yml", size: 30 },
        ],
      },
    ],
  })),
}));

async function attachServerFiles() {
  await userEvent.click(screen.getByRole("button", { name: /attach files|joindre des fichiers/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /serveur|server/i }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /categories/i }));
  await userEvent.click(screen.getByRole("checkbox", { name: /shop.yml/i }));
  await userEvent.click(screen.getByRole("button", { name: /^joindre$|^attach$/i }));
}

function setup() {
  useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
  useAccountStore.getState().setAccount({
    id: "a" as never,
    projects: [],
    projectOrder: [],
  } as never);
  useAccountStore.getState().createProject({ id: "p" });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AssistantChat", () => {
  it.each(["accepted", "failed"])(
    "shows server send status until the first event is %s",
    async (outcome) => {
      setup();
      const { streamAssistant, AssistantRequestError } = await import("@/lib/api/assistant");
      const pending = Promise.withResolvers<void>();
      const response = Promise.withResolvers<void>();
      vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
        await pending.promise;
        yield { type: "tool", name: "read_attachment", ok: true };
        await response.promise;
      });
      render(<AssistantChat projectId={projectId("p")} networkId="n" serverId="s" serverOnline />);
      await attachServerFiles();
      await userEvent.type(screen.getByRole("textbox"), "migre tout");
      await userEvent.click(screen.getByRole("button", { name: /^(send|envoyer)$/i }));
      expect(screen.getByRole("status")).toHaveTextContent(/Sending files|Envoi des fichiers/i);
      expect(screen.getByRole("textbox")).toBeDisabled();
      expect(screen.getByRole("textbox")).toHaveValue("migre tout");
      await act(async () => {
        if (outcome === "failed") pending.reject(new AssistantRequestError("read_error", 500));
        else pending.resolve();
      });
      expect(screen.queryByTestId("assistant-send-status")).toBeNull();
      if (outcome === "failed") {
        expect(screen.getByRole("textbox")).toBeEnabled();
        expect(screen.getByRole("textbox")).toHaveValue("migre tout");
        expect(screen.getByTestId("assistant-server-attachments")).toBeInTheDocument();
      } else {
        expect(screen.getByRole("textbox")).toHaveValue("");
        expect(screen.getByTestId("assistant-thinking")).toHaveTextContent(/Reading|Lecture/i);
        await act(async () => response.resolve());
      }
    },
  );

  it("sends local and server attachments together and clears the accepted composer", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} networkId="n" serverId="s" serverOnline />);
    await attachServerFiles();
    fireEvent.drop(screen.getByTestId("assistant-panel"), {
      dataTransfer: { files: [new File(["name: Local"], "local.yml")] },
    });
    await screen.findByText("local.yml");
    await userEvent.type(screen.getByRole("textbox"), "migre tout");
    await userEvent.click(screen.getByRole("button", { name: /^(send|envoyer)$/i }));
    const { streamAssistant } = await import("@/lib/api/assistant");
    await waitFor(() =>
      expect(streamAssistant).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({
          text: "migre tout",
          attachments: { "local.yml": "name: Local" },
          serverAttachments: [{ sourceId: "zmenu", paths: ["categories/blocks.yml", "shop.yml"] }],
        }),
      ),
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByTestId("assistant-attachments")).toBeNull();
    expect(screen.queryByTestId("assistant-server-attachments")).toBeNull();
  });

  it("preserves both attachment origins and text when preflight fails without adding a bubble", async () => {
    setup();
    const { streamAssistant, AssistantRequestError } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield await Promise.reject(new AssistantRequestError("not_found", 404, "shop.yml"));
    });
    render(<AssistantChat projectId={projectId("p")} networkId="n" serverId="s" serverOnline />);
    await attachServerFiles();
    fireEvent.drop(screen.getByTestId("assistant-panel"), {
      dataTransfer: { files: [new File(["local"], "local.yml")] },
    });
    await screen.findByText("local.yml");
    await userEvent.type(screen.getByRole("textbox"), "migre tout");
    await userEvent.click(screen.getByRole("button", { name: /^(send|envoyer)$/i }));
    await screen.findByTestId("assistant-error");
    expect(screen.getByRole("textbox")).toHaveValue("migre tout");
    expect(screen.getByText("local.yml")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-server-attachments")).toHaveTextContent("zMenu");
    expect(
      screen.getByTestId("assistant-transcript").querySelector('[data-role="user"]'),
    ).toBeNull();
  });

  it("expands and removes a server group and allows attachments-only sends", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} networkId="n" serverId="s" serverOnline />);
    await attachServerFiles();
    expect(screen.getByRole("button", { name: /^(send|envoyer)$/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /développer zMenu|expand zMenu/i }));
    expect(screen.getByText("categories/blocks.yml")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retirer zMenu|remove zMenu/i }));
    expect(screen.queryByTestId("assistant-server-attachments")).toBeNull();
    expect(screen.getByRole("button", { name: /^(send|envoyer)$/i })).toBeDisabled();
  });

  it("keeps local file selection available when the server is offline", async () => {
    setup();
    render(
      <AssistantChat projectId={projectId("p")} networkId="n" serverId="s" serverOnline={false} />,
    );
    const click = vi.spyOn(screen.getByTestId("assistant-file-input"), "click");
    await userEvent.click(
      screen.getByRole("button", { name: /attach files|joindre des fichiers/i }),
    );
    expect(screen.getByRole("menuitem", { name: /serveur|server/i })).toHaveAttribute(
      "data-disabled",
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /appareil|device/i }));
    expect(click).toHaveBeenCalledOnce();
  });
  it("renders the transcript and composer", () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("streams assistant text and applies a written menu to the project", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    // (a) streamed text appears, coalesced into a single line.
    await waitFor(() =>
      expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/Voici le menu\./),
    );

    // (b) the written menu is actually applied to the project.
    await waitFor(() => {
      const project = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === projectId("p"));
      expect(project?.menus.find((m) => m.id === "shop")).toBeTruthy();
    });

    expect(screen.getByText(/(modifié|updated)\s*:?\s*shop/i)).toBeTruthy();

    // Rien n'est écrit sur le serveur : ce que l'assistant génère vit dans la
    // page jusqu'à ce que l'admin clique sur Enregistrer (ADR
    // `server-disk-only-storage`, décision 3).
  });

  it("applies a command_written event via applyAssistantCommand", async () => {
    setup();
    const spy = vi.spyOn(useAccountStore.getState(), "applyAssistantCommand");
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield {
        type: "command_written",
        command: { schema: "command/v1", id: "heal", name: "heal", steps: [] },
      };
      yield { type: "done", stopReason: "end_turn" };
    });
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais une commande");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectId("p"),
          commandV1: expect.objectContaining({ id: "heal" }),
          lang: "en",
        }),
      ),
    );
  });

  it("applies a dialog_written event via applyAssistantDialog", async () => {
    setup();
    const spy = vi.spyOn(useAccountStore.getState(), "applyAssistantDialog");
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield {
        type: "dialog_written",
        dialog: { schema: "dialog/v1", id: "d", title: "T", buttons: [] },
      };
      yield { type: "done", stopReason: "end_turn" };
    });
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un dialog");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectId("p"),
          dialogV1: expect.objectContaining({ id: "d" }),
          lang: "en",
        }),
      ),
    );
  });

  it("a tool event updates the activity indicator", async () => {
    setup();
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield { type: "tool", name: "list_menus", ok: true };
      // Stay busy so the indicator remains mounted for the assertion.
      await new Promise((r) => setTimeout(r, 50));
    });
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "regarde les menus");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(screen.getByTestId("assistant-thinking").textContent).toMatch(
        /(Analyse des menus|Scanning menus)/i,
      ),
    );
  });

  it("an error event shows a persistent interrupted line", async () => {
    setup();
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield { type: "error", message: "boom" };
    });
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un truc");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() => {
      const err = screen.getByTestId("assistant-error");
      expect(err.textContent).toMatch(/boom/);
    });
    // It persists after the turn ends (busy is false).
    expect(screen.queryByTestId("assistant-thinking")).toBeNull();
  });

  it("localizes an incomplete attachment reading error with the counts", async () => {
    setup();
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield {
        type: "error",
        code: "attachments_not_read",
        readCount: 2,
        totalCount: 30,
        message: "Attachment reading incomplete (2/30). Please retry.",
      };
    });
    render(<AssistantChat projectId={projectId("p")} />);
    await userEvent.type(screen.getByRole("textbox"), "migre les fichiers");
    await userEvent.click(screen.getByRole("button", { name: /^(send|envoyer)$/i }));
    expect(await screen.findByTestId("assistant-error")).toHaveTextContent(
      /Lecture des fichiers incomplète \(2\/30\)/,
    );
    expect(screen.queryByTestId("assistant-send-status")).toBeNull();
  });

  it("a thrown stream shows the interrupted line", async () => {
    setup();
    const { streamAssistant } = await import("@/lib/api/assistant");
    vi.mocked(streamAssistant).mockImplementationOnce(async function* () {
      yield { type: "text", text: "hmm" };
      throw new Error("network down");
    });
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un truc");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(screen.getByTestId("assistant-error").textContent).toMatch(
        /(Interrompu|Interrupted)/i,
      ),
    );
  });

  it("resumes a conversation: loads its transcript on mount", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} conversationId="c1" />);
    await waitFor(() => {
      const text = screen.getByTestId("assistant-transcript").textContent ?? "";
      expect(text).toMatch(/salut/);
      expect(text).toMatch(/bonjour/);
    });
  });

  it("lists dropped files with name and size", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    const panel = screen.getByTestId("assistant-panel");
    const content = "name: '&8Menu'\nsize: 54";
    const file = new File([content], "menu.yml", { type: "text/yaml" });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());
    expect(screen.getByText(`${content.length} B`)).toBeTruthy();
  });

  it("removes an attachment from the list", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

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
    render(<AssistantChat projectId={projectId("p")} />);

    const input = screen.getByTestId("assistant-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["kit: x"], "kits.yml", { type: "text/yaml" })] },
    });

    await waitFor(() => expect(screen.getByText("kits.yml")).toBeTruthy());
  });

  it("sends with attachments only: no text required", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

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
        "c1",
        expect.objectContaining({ text: "", attachments: { "menu.yml": "size: 54" } }),
      ),
    );
    // The user bubble names the sent files instead of showing an empty message.
    expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/menu\.yml/);
  });

  it("keeps send disabled with neither text nor attachments", () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);
    const sendBtn = screen.getByText(/^(send|envoyer)$/i).closest("button");
    expect(sendBtn?.disabled).toBe(true);
  });

  it("sends the attached file contents with the message", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    fireEvent.drop(screen.getByTestId("assistant-panel"), {
      dataTransfer: { files: [new File(["size: 54"], "menu.yml", { type: "text/yaml" })] },
    });
    await waitFor(() => expect(screen.getByText("menu.yml")).toBeTruthy());

    await userEvent.type(screen.getByRole("textbox"), "migre ce fichier");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    const { streamAssistant } = await import("@/lib/api/assistant");
    await waitFor(() =>
      expect(streamAssistant).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({ attachments: { "menu.yml": "size: 54" } }),
      ),
    );
  });
});
