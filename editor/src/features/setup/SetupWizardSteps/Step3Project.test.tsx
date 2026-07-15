import * as networksApi from "@/lib/api/networks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardState } from "../SetupWizard";
import { Step3Project } from "./Step3Project";

const stateWithServer: WizardState = {
  networkId: "n1",
  projectId: null,
  linkCode: "ABCD2345",
  serverKeyId: "sk-1",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step3Project", () => {
  it("lists only projects bound to the current server_key, not the whole network", async () => {
    // A pack belongs to exactly one server_key (projects.serverKeyId, 1:N). The
    // wizard fetches the whole network, so it must filter to the step-2 server
    // — otherwise it offers workspaces owned by OTHER servers (the old M:N fossil).
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Survival", tier: "free" },
      projects: [
        { id: "p1", name: "This Server Project", hash: "h1", networkId: "n1", serverKeyId: "sk-1" },
        {
          id: "p2",
          name: "Other Server Project",
          hash: "h2",
          networkId: "n1",
          serverKeyId: "sk-2",
        },
      ],
      serverKeys: [],
    });

    render(<Step3Project state={stateWithServer} setState={() => {}} />);

    // sk-1 matches state.serverKeyId → shown
    await waitFor(() => expect(screen.getByText("This Server Project")).toBeTruthy());
    // sk-2 belongs to a different server → must NOT be offered
    expect(screen.queryByText("Other Server Project")).toBeNull();
  });

  it("creates a new pack using the already-known serverKeyId and selects it", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Survival", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    const createSpy = vi.spyOn(networksApi, "createProject").mockResolvedValue({
      id: "p-new",
      name: "My New Project",
      hash: "",
    });

    const setState = vi.fn();
    render(<Step3Project state={stateWithServer} setState={setState} />);

    await waitFor(() => expect(screen.getByPlaceholderText(/my_project/i)).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText(/my_project/i), "My New Project");
    await userEvent.click(screen.getByRole("button", { name: /créer|create/i }));

    // serverKeyId is now wired from Step 2 — no more "" fallback
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1", "sk-1", "My New Project"));
    expect(setState).toHaveBeenCalled();
    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(stateWithServer);
    expect(newState.projectId).toBe("p-new");
  });
});
