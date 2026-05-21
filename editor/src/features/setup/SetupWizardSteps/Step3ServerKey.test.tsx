import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step3ServerKey } from "./Step3ServerKey";
import * as networksApi from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

const stateReady: WizardState = {
  networkId: "n1",
  packId: "p1",
  serverKey: null,
  serverKeyId: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Step3ServerKey", () => {
  it("generates a server key, binds it to the pack, and stores the plaintext key", async () => {
    const createSpy = vi.spyOn(networksApi, "createServerKey").mockResolvedValue({
      id: "sk-abc",
      key: "ifz_sk_plaintext123",
      label: null,
    });
    const bindSpy = vi.spyOn(networksApi, "bindPackToServerKey").mockResolvedValue(undefined);

    const setState = vi.fn();
    render(<Step3ServerKey state={stateReady} setState={setState} />);

    await userEvent.click(screen.getByRole("button", { name: /generate server key/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1"));
    expect(bindSpy).toHaveBeenCalledWith("n1", "p1", "sk-abc");
    expect(setState).toHaveBeenCalled();

    const updater = setState.mock.calls[0][0] as (s: WizardState) => WizardState;
    const newState = updater(stateReady);
    expect(newState.serverKey).toBe("ifz_sk_plaintext123");
    expect(newState.serverKeyId).toBe("sk-abc");
  });
});
