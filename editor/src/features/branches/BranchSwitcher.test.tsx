import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BranchSwitcher } from "./BranchSwitcher";
import { useBranchesStore } from "@/state/branchesStore";
import * as branchesApi from "@/lib/api/branches";

describe("BranchSwitcher", () => {
  beforeEach(() => {
    useBranchesStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("fetches branches on mount + selects main by default", async () => {
    vi.spyOn(branchesApi, "listBranches").mockResolvedValue([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    render(<BranchSwitcher networkId="n1" packId="p1" />);
    await waitFor(() => expect(useBranchesStore.getState().branches).toHaveLength(2));
    expect(useBranchesStore.getState().currentBranch).toBe("main");
  });

  it("switching the dropdown updates currentBranch", async () => {
    vi.spyOn(branchesApi, "listBranches").mockResolvedValue([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    render(<BranchSwitcher networkId="n1" packId="p1" />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dev" } });
    expect(useBranchesStore.getState().currentBranch).toBe("dev");
  });
});
