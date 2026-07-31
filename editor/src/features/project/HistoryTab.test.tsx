import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryTab } from "./HistoryTab";
import * as branchesApi from "@/lib/api/branches";
import * as accountStoreModule from "@/state/accountStore";

vi.mock("@/state/accountStore", () => ({
  useAccountStore: Object.assign(
    vi.fn((sel: (s: { replaceProject: ReturnType<typeof vi.fn> }) => unknown) =>
      sel({ replaceProject: vi.fn() }),
    ),
    { getState: () => ({ replaceProject: vi.fn() }) },
  ),
}));

// Suppress unused import lint warning
void accountStoreModule;

describe("HistoryTab", () => {
  it("lists commits and a Restore button per non-root commit", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "c2", projectId: "p1", parentId: "c1", contentHash: "h2", authorUserId: null, message: "Deploy", createdAt: "2026-06-01" },
      { id: "c1", projectId: "p1", parentId: null, contentHash: "h1", authorUserId: null, message: "Initial commit", createdAt: "2026-05-30" },
    ]);
    render(<HistoryTab project={{ id: "p1", name: "P" } as Parameters<typeof HistoryTab>[0]["project"]} networkId="n1" />);
    await screen.findByText(/Initial commit/i);
    // c2 has parentId="c1" (not root) → gets a Restore button
    // c1 is the root commit (index 1 = last, parentId=null) → no Restore button
    const restoreButtons = screen.getAllByRole("button", { name: /restore|restaurer/i });
    expect(restoreButtons.length).toBe(1);
  });

  it("renders commits newest-first (HEAD on top, root last) even when the API order and timestamps don't help", async () => {
    // API returns oldest-first AND every commit shares a timestamp — only the
    // parent chain disambiguates. orderHeadFirst must still put HEAD on top.
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "c1", projectId: "p1", parentId: null, contentHash: "h1", authorUserId: null, message: "Initial commit", createdAt: "2026-06-01T00:00:00Z" },
      { id: "c2", projectId: "p1", parentId: "c1", contentHash: "h2", authorUserId: null, message: "Second", createdAt: "2026-06-01T00:00:00Z" },
      { id: "c3", projectId: "p1", parentId: "c2", contentHash: "h3", authorUserId: null, message: "Third", createdAt: "2026-06-01T00:00:00Z" },
    ]);
    render(<HistoryTab project={{ id: "p1", name: "P" } as Parameters<typeof HistoryTab>[0]["project"]} networkId="n1" />);
    await screen.findByText(/Third/);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Third"); // HEAD (tip)
    expect(items[0]).toHaveTextContent("HEAD");
    expect(items[2]).toHaveTextContent("Initial commit"); // root last
  });

  it("shows all commits and Restore buttons for multi-commit non-root entries", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "c3", projectId: "p1", parentId: "c2", contentHash: "h3", authorUserId: null, message: "Third", createdAt: "2026-06-02" },
      { id: "c2", projectId: "p1", parentId: "c1", contentHash: "h2", authorUserId: null, message: "Second", createdAt: "2026-06-01" },
      { id: "c1", projectId: "p1", parentId: null, contentHash: "h1", authorUserId: null, message: "Initial commit", createdAt: "2026-05-30" },
    ]);
    render(<HistoryTab project={{ id: "p1", name: "P" } as Parameters<typeof HistoryTab>[0]["project"]} networkId="n1" />);
    await screen.findByText(/Initial commit/i);
    // c3 and c2 are non-root; c1 is last + parentId=null → no button for c1
    const restoreButtons = screen.getAllByRole("button", { name: /restore|restaurer/i });
    expect(restoreButtons.length).toBe(2);
  });
});
