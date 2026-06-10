import * as networksApi from "@/lib/api/networks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardState } from "../SetupWizard";
import { Step2Server } from "./Step2Server";

const stateReady: WizardState = {
  networkId: "n1",
  packId: null,
  serverKey: null,
  serverKeyId: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step2Server", () => {
  it("generates a server key and stores the plaintext key (no bind call)", async () => {
    const createSpy = vi.spyOn(networksApi, "createServerKey").mockResolvedValue({
      id: "sk-abc",
      key: "artisan_sk_plaintext123",
      label: null,
    });

    const setState = vi.fn();
    render(<Step2Server state={stateReady} setState={setState} />);

    // The server name is required + forwarded as the key's label (→ slug).
    await userEvent.type(screen.getByRole("textbox"), "Lobby");
    await userEvent.click(screen.getByRole("button", { name: /générer|generate server/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1", "Lobby"));
    expect(setState).toHaveBeenCalled();

    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(stateReady);
    expect(newState.serverKey).toBe("artisan_sk_plaintext123");
    expect(newState.serverKeyId).toBe("sk-abc");
  });
});
