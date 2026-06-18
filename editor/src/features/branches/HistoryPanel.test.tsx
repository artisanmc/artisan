import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HistoryPanel } from "./HistoryPanel";
import * as branchesApi from "@/lib/api/branches";

describe("HistoryPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists commits for the branch", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "cmt_2", projectId: "p", parentId: "cmt_1", contentHash: "x", authorUserId: "u", message: "second", createdAt: new Date().toISOString() },
      { id: "cmt_1", projectId: "p", parentId: null, contentHash: "y", authorUserId: null, message: "initial", createdAt: new Date().toISOString() },
    ]);
    render(<HistoryPanel networkId="n1" projectId="p1" branch="main" />);
    await waitFor(() => expect(screen.getByText("second")).toBeTruthy());
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("shows empty state when no commits", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([]);
    render(<HistoryPanel networkId="n1" projectId="p1" branch="main" />);
    await waitFor(() => expect(screen.getByText(/no commits yet/i)).toBeTruthy());
  });
});
