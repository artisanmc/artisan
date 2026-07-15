import * as networksApi from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardState } from "../SetupWizard";
import { Step2Server } from "./Step2Server";

const stateReady: WizardState = {
  networkId: "n1",
  projectId: null,
  linkCode: null,
  serverKeyId: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step2Server", () => {
  it("creates a server and stores the link code (no plaintext key)", async () => {
    const createSpy = vi.spyOn(networksApi, "createServerKey").mockResolvedValue({
      id: "sk-abc",
      label: null,
      code: "ABCD2345",
      expires_at: "2099-01-01T00:00:00Z",
    });

    const setState = vi.fn();
    render(<Step2Server state={stateReady} setState={setState} />);

    await userEvent.type(screen.getByRole("textbox"), "Lobby");
    await userEvent.click(screen.getByRole("button", { name: /créer le serveur|create server/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1", "Lobby"));
    expect(setState).toHaveBeenCalled();

    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(stateReady);
    expect(newState.linkCode).toBe("ABCD2345");
    expect(newState.serverKeyId).toBe("sk-abc");
  });

  it("bumps the networks store refresh token so the sidebar picks up the new server", async () => {
    vi.spyOn(networksApi, "createServerKey").mockResolvedValue({
      id: "sk-abc",
      label: null,
      code: "ABCD2345",
      expires_at: "2099-01-01T00:00:00Z",
    });
    const before = useNetworksStore.getState().refreshToken;

    render(<Step2Server state={stateReady} setState={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "Lobby");
    await userEvent.click(screen.getByRole("button", { name: /créer le serveur|create server/i }));

    await waitFor(() => expect(useNetworksStore.getState().refreshToken).toBe(before + 1));
  });
});
