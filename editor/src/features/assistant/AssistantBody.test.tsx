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
  it("starts with the conversation list when switching projects", async () => {
    const { rerender } = render(
      <AssistantBody projectId={projectId("p")} networkId="n" serverId="s" serverOnline />,
    );
    await userEvent.click(screen.getByText(/new conversation|nouvelle conversation/i));
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
    rerender(
      <AssistantBody
        projectId={projectId("other")}
        networkId="n"
        serverId="other-server"
        serverOnline
      />,
    );
    expect(screen.getByTestId("assistant-conversations")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });
  it("forwards the offline server context into the real composer", async () => {
    render(
      <AssistantBody projectId={projectId("p")} networkId="n" serverId="s" serverOnline={false} />,
    );
    await userEvent.click(screen.getByText(/new conversation|nouvelle conversation/i));
    await userEvent.click(
      screen.getByRole("button", { name: /joindre des fichiers|attach files/i }),
    );
    expect(screen.getByRole("menuitem", { name: /serveur|server/i })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: /appareil|device/i })).not.toHaveAttribute(
      "data-disabled",
    );
  });
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
