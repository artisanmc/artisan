import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Step4Install } from "./Step4Install";
import type { WizardState } from "../SetupWizard";

const stateWithKey: WizardState = {
  networkId: "n1",
  projectId: "p1",
  serverKey: "artisan_sk_plaintext_abc123",
  serverKeyId: "sk-abc",
};

describe("Step4Install", () => {
  it("displays the server key and the config snippet", () => {
    render(<Step4Install state={stateWithKey} setState={() => {}} />);

    // The server key should appear (at least once in the page)
    const keyElements = screen.getAllByText(/artisan_sk_plaintext_abc123/);
    expect(keyElements.length).toBeGreaterThan(0);

    // The config snippet contains the backend-url key
    expect(screen.getByText(/backend-url/)).toBeTruthy();
  });

  it("shows the /artisan reload instruction", () => {
    render(<Step4Install state={stateWithKey} setState={() => {}} />);
    expect(screen.getByText(/\/artisan reload/)).toBeTruthy();
  });
});
