import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeConflictModal } from "./MergeConflictModal";
import * as branchesApi from "@/lib/api/branches";

const planWithConflict = {
  kind: "conflicts" as const,
  conflicts: [{
    conflictKey: "menus:m_x",
    collection: "menus",
    resolution: "modify-modify" as const,
    srcValue: { id: "m_x", name: "src-x" },
    dstValue: { id: "m_x", name: "dst-x" },
    baseValue: { id: "m_x", name: "base-x" },
  }],
  mergedEditorJson: { menus: [{ id: "m_x", name: "dst-x" }] },
  lcaCommitId: "cmt_lca",
  srcCommitId: "cmt_src",
  dstCommitId: "cmt_dst",
};

describe("MergeConflictModal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders conflict items with radio buttons for src/dst", () => {
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/menus:m_x/i)).toBeTruthy();
    expect(screen.getByLabelText(/use dev/i)).toBeTruthy();
    expect(screen.getByLabelText(/use main/i)).toBeTruthy();
  });

  it("Confirm button disabled until all conflicts resolved", () => {
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByRole("button", { name: /confirm merge/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/use dev/i));
    expect((screen.getByRole("button", { name: /confirm merge/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Confirm calls resolveMerge with resolutions", async () => {
    const spy = vi.spyOn(branchesApi, "resolveMerge").mockResolvedValue({
      commit: { id: "cmt_merge", packId: "p1", parentId: "cmt_dst", contentHash: "x",
                authorUserId: null, message: "Merge dev into main", createdAt: "" },
      head_commit_id: "cmt_merge",
    });
    const onResolved = vi.fn();
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={onResolved}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/use dev/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm merge/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "dev", "main", expect.objectContaining({
      resolutions: { "menus:m_x": "src" },
      lcaCommitId: "cmt_lca",
    })));
    expect(onResolved).toHaveBeenCalledWith("cmt_merge");
  });

  it("Cancel calls onCancel without API", () => {
    const onCancel = vi.fn();
    const spy = vi.spyOn(branchesApi, "resolveMerge");
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("auto kind (no conflicts) renders the confirmation summary", () => {
    const autoPlan = { ...planWithConflict, kind: "auto" as const, conflicts: [] };
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={autoPlan}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/no conflicts/i)).toBeTruthy();
  });
});
