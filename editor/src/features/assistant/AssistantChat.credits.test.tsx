import { projectId } from "@/domain/ids";
import { formatCredits } from "@/lib/format";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantChat } from "./AssistantChat";


vi.mock("@/lib/api/aiUser", () => ({
  getModels: vi.fn(async () => ({ models: [], defaultModelId: null, preferredModelId: null })),
  getBalance: vi.fn(async () => ({ total: 500, subscription: 0, rollover: 0, topup: 500 })),
  setPreferredModel: vi.fn(async () => true),
}));

vi.mock("@/lib/api/assistant", () => ({
  openConversation: vi.fn(async () => "c1"),
  streamAssistant: vi.fn(async function* () {
    yield { type: "text", text: "ok" };
    yield { type: "credits", debited: 12, balance: 488 };
    yield { type: "done", stopReason: "end_turn" };
  }),
  getConversation: vi.fn(async () => ({
    id: "c1",
    projectId: "p",
    title: "Hi",
    messages: [],
    updatedAt: "2026-06-10T00:00:00Z",
  })),
}));

const norm = (s: string) => s.replace(/\s/gu, " ");

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

describe("AssistantChat — credits", () => {
  it("shows the initial balance fetched on mount", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    await waitFor(() =>
      expect(screen.getByText(norm(`${formatCredits(500, "fr")} crédits`))).toBeTruthy(),
    );
  });

  it("updates the balance from a streamed credits event after sending", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    await waitFor(() =>
      expect(screen.getByText(norm(`${formatCredits(500, "fr")} crédits`))).toBeTruthy(),
    );

    await userEvent.type(screen.getByRole("textbox"), "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() =>
      expect(screen.getByText(norm(`${formatCredits(488, "fr")} crédits`))).toBeTruthy(),
    );
    expect(screen.queryByText(norm(`${formatCredits(500, "fr")} crédits`))).toBeNull();
  });
});
