import * as networksApi from "@/lib/api/networks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardState } from "../SetupWizard";
import { Step1Network } from "./Step1Network";

const baseState: WizardState = {
  networkId: null,
  projectId: null,
  linkCode: null,
  serverKeyId: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step1Network", () => {
  it("lists existing networks from the API", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival Network", tier: "free" },
      { id: "n2", name: "Creative Network", tier: "free" },
    ]);

    render(<Step1Network state={baseState} setState={() => {}} />);

    await waitFor(() => expect(screen.getByText("Survival Network")).toBeTruthy());
    expect(screen.getByText("Creative Network")).toBeTruthy();
  });

  it("creates a new network and selects it", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    const createSpy = vi.spyOn(networksApi, "createNetwork").mockResolvedValue({
      id: "n-new",
      name: "My New Network",
      tier: "free",
    });

    const setState = vi.fn();
    render(<Step1Network state={baseState} setState={setState} />);

    await waitFor(() => expect(screen.getByPlaceholderText(/my_network/i)).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText(/my_network/i), "My New Network");
    await userEvent.click(screen.getByRole("button", { name: /créer|create/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("My New Network"));
    expect(setState).toHaveBeenCalled();
    // Verify the state update sets the networkId to the new network's id
    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(baseState);
    expect(newState.networkId).toBe("n-new");
  });
});
