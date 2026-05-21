import { describe, it, expect, beforeEach } from "vitest";
import { useBranchesStore } from "./branchesStore";

describe("branchesStore", () => {
  beforeEach(() => useBranchesStore.getState().reset());

  it("setBranches replaces the list and updates currentBranch if missing", () => {
    useBranchesStore.getState().setBranches([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
    ]);
    expect(useBranchesStore.getState().branches).toHaveLength(1);
    expect(useBranchesStore.getState().currentBranch).toBe("main");
  });

  it("setCurrentBranch updates the selection", () => {
    useBranchesStore.getState().setBranches([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    useBranchesStore.getState().setCurrentBranch("dev");
    expect(useBranchesStore.getState().currentBranch).toBe("dev");
  });

  it("reset empties state", () => {
    useBranchesStore.getState().setBranches([{ packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" }]);
    useBranchesStore.getState().reset();
    expect(useBranchesStore.getState().branches).toHaveLength(0);
    expect(useBranchesStore.getState().currentBranch).toBeNull();
  });
});
