import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WizardState } from "../SetupWizard";
import { Step4Install } from "./Step4Install";

const stateWithCode: WizardState = {
  networkId: "n1",
  projectId: "p1",
  linkCode: "ABCD2345",
  serverKeyId: "sk-abc",
};

describe("Step4Install", () => {
  it("shows the ws_url config snippet", () => {
    render(<Step4Install state={stateWithCode} setState={() => {}} />);
    expect(screen.getByText(/ws_url/)).toBeTruthy();
  });

  it("shows the /artisan link <code> instruction", () => {
    render(<Step4Install state={stateWithCode} setState={() => {}} />);
    expect(screen.getByText(/\/artisan link ABCD2345/)).toBeTruthy();
  });
});
