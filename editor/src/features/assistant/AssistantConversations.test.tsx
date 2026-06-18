import { projectId } from "@/domain/ids";
import { listConversations } from "@/lib/api/assistant";
import { useSessionStore } from "@/state/sessionStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantConversations } from "./AssistantConversations";

vi.mock("@/lib/api/assistant", () => ({
  listConversations: vi.fn(async () => []),
}));

beforeEach(() => {
  useSessionStore.setState({ accessToken: "tok" } as never);
});
afterEach(() => vi.clearAllMocks());

describe("AssistantConversations", () => {
  it("lists conversations and opens one on click", async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: "c1", title: "Shop menu", updatedAt: "2026-06-10T00:00:00Z" },
    ]);
    const onOpen = vi.fn();
    render(<AssistantConversations projectId={projectId("p")} onOpen={onOpen} onNew={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Shop menu")).toBeTruthy());
    await userEvent.click(screen.getByText("Shop menu"));
    expect(onOpen).toHaveBeenCalledWith("c1");
  });

  it("New conversation triggers onNew", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    const onNew = vi.fn();
    render(<AssistantConversations projectId={projectId("p")} onOpen={vi.fn()} onNew={onNew} />);
    await userEvent.click(screen.getByText(/new conversation|nouvelle conversation/i));
    expect(onNew).toHaveBeenCalled();
  });

  it("shows an empty state when there are no conversations", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    render(<AssistantConversations projectId={projectId("p")} onOpen={vi.fn()} onNew={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/no conversations|aucune conversation/i)).toBeTruthy(),
    );
  });
});
