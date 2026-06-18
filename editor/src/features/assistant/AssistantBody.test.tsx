import { projectId } from "@/domain/ids";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantBody } from "./AssistantBody";

vi.mock("@/lib/api/assistant", () => ({
  listConversations: vi.fn(async () => []),
  getConversation: vi.fn(),
  openConversation: vi.fn(),
  streamAssistant: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe("AssistantBody", () => {
  it("opens on the list; New starts a chat; Back returns to the list", async () => {
    render(<AssistantBody projectId={projectId("p")} />);

    // Opens on the conversation list.
    expect(screen.getByTestId("assistant-conversations")).toBeTruthy();

    // New conversation → chat body (composer present).
    await userEvent.click(screen.getByText(/new conversation|nouvelle conversation/i));
    expect(screen.getByTestId("assistant-panel")).toBeTruthy();

    // Back → list again.
    await userEvent.click(screen.getByText(/^conversations$/i));
    await waitFor(() => expect(screen.getByTestId("assistant-conversations")).toBeTruthy());
  });
});
