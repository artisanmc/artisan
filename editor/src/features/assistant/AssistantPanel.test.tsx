import { packId } from "@/domain/ids";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "./AssistantPanel";

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
}));

function setup() {
  useSessionStore.setState({ accessToken: "tok" } as never);
  useAccountStore.getState().setAccount({
    id: "a" as never,
    packs: [],
    packOrder: [],
  } as never);
  useAccountStore.getState().createPack({ id: "p" });
  useUiStore.getState().setAssistantPanelOpen(true);
}

afterEach(() => {
  vi.clearAllMocks();
  useUiStore.getState().setAssistantPanelOpen(false);
  useAuthStore.setState({ currentUser: null } as never);
});

describe("AssistantPanel", () => {
  it("renders SheetContent when the panel is open (radix portals to body)", () => {
    setup();
    render(<AssistantPanel packId={packId("p")} />);
    // The composer textarea lives inside SheetContent — its presence proves
    // the controlled `open` Sheet actually mounts the portaled content.
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("streams assistant text and applies a written menu to the pack", async () => {
    setup();
    render(<AssistantPanel packId={packId("p")} />);

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

    // The "created" card references the menu id ("Créé / modifié : shop" /
    // "Created / updated: shop"). Matched precisely so it doesn't collide with
    // the user's own "fais un shop" message in the transcript.
    expect(screen.getByText(/(modifié|updated)\s*:?\s*shop/i)).toBeTruthy();
  });

  it("sends in user-auth mode: no session token but a logged-in user", async () => {
    setup();
    // Web-login mode: no editor-session token, auth rides the user cookie.
    useSessionStore.setState({ accessToken: null } as never);
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    render(<AssistantPanel packId={packId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/Voici le menu\./),
    );
  });

  it("attaching a dropped file shows the attachment count", async () => {
    setup();
    render(<AssistantPanel packId={packId("p")} />);

    const panel = screen.getByTestId("assistant-panel");
    const file = new File(["name: '&8Menu'\nsize: 54"], "menu.yml", { type: "text/yaml" });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/1 file|1 fichier/i)).toBeTruthy());
  });
});
