import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step3Workspace } from "./Step3Workspace";
import * as networksApi from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

const stateWithServer: WizardState = {
  networkId: "n1",
  packId: null,
  serverKey: "artisan_sk_xxx",
  serverKeyId: "sk-1",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step3Workspace", () => {
  it("lists existing packs from the selected network", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Survival", tier: "free" },
      packs: [
        { id: "p1", name: "Shop Pack", hash: "h1" },
        { id: "p2", name: "Lobby Pack", hash: "h2" },
      ],
      serverKeys: [],
    });

    render(<Step3Workspace state={stateWithServer} setState={() => {}} />);

    await waitFor(() => expect(screen.getByText("Shop Pack")).toBeTruthy());
    expect(screen.getByText("Lobby Pack")).toBeTruthy();
  });

  it("creates a new pack using the already-known serverKeyId and selects it", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Survival", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    const createSpy = vi.spyOn(networksApi, "createPack").mockResolvedValue({
      id: "p-new",
      name: "My New Pack",
      hash: "",
    });

    const setState = vi.fn();
    render(<Step3Workspace state={stateWithServer} setState={setState} />);

    await waitFor(() => expect(screen.getByPlaceholderText(/my_pack/i)).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText(/my_pack/i), "My New Pack");
    await userEvent.click(screen.getByRole("button", { name: /créer|create/i }));

    // serverKeyId is now wired from Step 2 — no more "" fallback
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1", "sk-1", "My New Pack"));
    expect(setState).toHaveBeenCalled();
    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(stateWithServer);
    expect(newState.packId).toBe("p-new");
  });
});
