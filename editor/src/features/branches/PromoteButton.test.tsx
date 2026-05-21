import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromoteButton } from "./PromoteButton";
import * as branchesApi from "@/lib/api/branches";

describe("PromoteButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens picker + calls promoteBranch on confirm", async () => {
    const spy = vi.spyOn(branchesApi, "promoteBranch").mockResolvedValue({ ok: true, advanced: true });
    render(<PromoteButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /promote/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "dev", "main"));
  });

  it("shows error when 409 not_fast_forward", async () => {
    vi.spyOn(branchesApi, "promoteBranch").mockRejectedValue(new Error("not_fast_forward"));
    render(<PromoteButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /promote/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.getByText(/not_fast_forward/i)).toBeTruthy());
  });
});
