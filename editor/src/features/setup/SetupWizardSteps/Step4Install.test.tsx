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

  it("points ws_url at the backend host, never the editor host", () => {
    render(<Step4Install state={stateWithCode} setState={() => {}} />);
    const snippet = screen.getByText(/ws_url/).textContent ?? "";
    expect(snippet).toContain("api.artisanmc.net/ws/plugin");
    expect(snippet).not.toContain("editor.artisanmc.net");
  });

  it("shows the /artisan link <code> instruction", () => {
    render(<Step4Install state={stateWithCode} setState={() => {}} />);
    expect(screen.getByText(/\/artisan link ABCD2345/)).toBeTruthy();
  });
});
