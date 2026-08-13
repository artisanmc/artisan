import { projectId } from "@/domain/ids";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantChat } from "./AssistantChat";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));


vi.mock("@/lib/api/aiUser", () => ({
  getModels: vi.fn(async () => ({ models: [], defaultModelId: null, preferredModelId: null })),
  getBalance: vi.fn(async () => 500),
  setPreferredModel: vi.fn(async () => true),
}));

vi.mock("@/lib/api/assistant", () => ({
  openConversation: vi.fn(async () => "c1"),
  streamAssistant: vi.fn(async function* () {
    yield { type: "insufficient_credits", balance: 0 };
  }),
  getConversation: vi.fn(async () => ({
    id: "c1",
    projectId: "p",
    title: "Hi",
    messages: [],
    updatedAt: "2026-06-10T00:00:00Z",
  })),
}));

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

describe("AssistantChat — out of credits", () => {
  it("shows OutOfCreditsNotice, disables the composer, and navigates to /credits on CTA", async () => {
    setup();
    render(<AssistantChat projectId={projectId("p")} />);

    await userEvent.type(screen.getByRole("textbox"), "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));

    await waitFor(() => expect(screen.getByTestId("assistant-out-of-credits")).toBeTruthy());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);

    await userEvent.click(screen.getByText(/obtenir des crédits|get credits/i));
    expect(navigate).toHaveBeenCalledWith({ to: "/credits" });
  });
});
