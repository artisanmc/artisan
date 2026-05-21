import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommitDialog } from "./CommitDialog";
import * as branchesApi from "@/lib/api/branches";

describe("CommitDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls createCommit with message + currentBranch on submit", async () => {
    const spy = vi.spyOn(branchesApi, "createCommit").mockResolvedValue({
      id: "cmt_new", packId: "p", parentId: null, contentHash: "", authorUserId: null, message: "", createdAt: "",
    });
    const onClose = vi.fn();
    render(<CommitDialog networkId="n1" packId="p1" branch="main" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/commit message/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "main", "hello"));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables button when message empty", () => {
    render(<CommitDialog networkId="n1" packId="p1" branch="main" open onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /commit/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
