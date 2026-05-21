import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeButton } from "./MergeButton";
import * as branchesApi from "@/lib/api/branches";

// Stub MergeConflictModal so we can assert it's opened on conflicts.
vi.mock("./MergeConflictModal", () => ({
  MergeConflictModal: (props: { onResolved?: () => void }) => (
    <div data-testid="conflict-modal-mock">conflict modal: {String(!!props.onResolved)}</div>
  ),
}));

describe("MergeButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens dialog with target picker", () => {
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    expect(screen.getByLabelText(/target branch/i)).toBeTruthy();
  });

  it("submits then shows the fast_forward toast (auto-close)", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockResolvedValue({
      kind: "fast_forward", advanced: true, head_commit_id: "cmt_x",
    });
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByText(/fast-forwarded/i)).toBeTruthy());
  });

  it("opens MergeConflictModal on conflicts", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockResolvedValue({
      kind: "conflicts",
      conflicts: [{ conflictKey: "menus:m_x", collection: "menus", resolution: "modify-modify",
                   srcValue: { id: "m_x", name: "s" }, dstValue: { id: "m_x", name: "d" }, baseValue: null }],
      mergedEditorJson: { menus: [{ id: "m_x", name: "d" }] },
      lcaCommitId: "cmt_lca", srcCommitId: "cmt_src", dstCommitId: "cmt_dst",
    });
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByTestId("conflict-modal-mock")).toBeTruthy());
  });

  it("shows error message on API failure", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockRejectedValue(new Error("same_branch"));
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByText(/same_branch/i)).toBeTruthy());
  });
});
