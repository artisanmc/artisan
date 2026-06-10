import { packId } from "@/domain/ids";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantPane } from "./AssistantPane";

// The pane embeds AssistantChat, which imports the SSE client at module load.
vi.mock("@/lib/api/assistant", () => ({
  openConversation: vi.fn(),
  streamAssistant: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  useUiStore.getState().setAssistantPanelOpen(false);
});

describe("AssistantPane", () => {
  it("renders a header and closes via the close button", async () => {
    useUiStore.getState().setAssistantPanelOpen(true);
    render(<AssistantPane packId={packId("p")} />);

    expect(screen.getByTestId("assistant-pane")).toBeTruthy();
    // The close button is labelled by aria-label (assistant.close = Fermer/Close),
    // distinct from the chat's "Send" button.
    await userEvent.click(screen.getByRole("button", { name: /close|fermer/i }));
    expect(useUiStore.getState().assistantPanelOpen).toBe(false);
  });
});
