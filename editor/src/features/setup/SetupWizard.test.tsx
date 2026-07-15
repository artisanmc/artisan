import * as networksApi from "@/lib/api/networks";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupWizard, type WizardState } from "./SetupWizard";

const navigate = vi.fn();

// Mock out the router so Link / useNavigate don't explode
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
    useNavigate: () => navigate,
  };
});

// Stub API so Step1Network's useEffect resolves silently
vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);

describe("SetupWizard", () => {
  it("starts on step 1", () => {
    render(<SetupWizard />);
    // Step 1 is the "Network" step — its label is rendered as a stepper item
    expect(screen.getAllByText(/network/i).length).toBeGreaterThan(0);
  });

  it("Next is disabled when no network chosen (step 1)", () => {
    render(<SetupWizard />);
    const nextBtn = screen.getByRole("button", { name: /next|suivant/i });
    expect(nextBtn).toBeDisabled();
  });
});

/**
 * Regression: the final "Terminé / Done" button used to stay disabled because
 * `canNext(4, state)` returned false, and clicking it (had it been enabled)
 * was a no-op — no exit handler.
 */
describe("SetupWizard — final step (canNext)", () => {
  it("step 4 always allows Next regardless of state (so the Done button is enabled)", async () => {
    const { canNext } = await import("./SetupWizard");
    const empty: WizardState = {
      networkId: null,
      projectId: null,
      linkCode: null,
      serverKeyId: null,
    };
    const full: WizardState = {
      networkId: "n1",
      projectId: "p1",
      linkCode: "ABCD2345",
      serverKeyId: "sk1",
    };
    // The bug was: canNext(4, *) returned false. The fix: always true on step 4.
    expect(canNext(4, empty)).toBe(true);
    expect(canNext(4, full)).toBe(true);
  });

  it("steps 1-3 still gate on their respective fields (server before workspace)", async () => {
    const { canNext } = await import("./SetupWizard");
    const empty: WizardState = {
      networkId: null,
      projectId: null,
      linkCode: null,
      serverKeyId: null,
    };
    expect(canNext(1, empty)).toBe(false);
    expect(canNext(2, empty)).toBe(false);
    expect(canNext(3, empty)).toBe(false);
    expect(canNext(1, { ...empty, networkId: "n1" })).toBe(true);
    // Step 2 is now Server — gates on serverKeyId
    expect(canNext(2, { ...empty, serverKeyId: "sk1" })).toBe(true);
    // Step 3 is now Project — gates on projectId
    expect(canNext(3, { ...empty, projectId: "p1" })).toBe(true);
  });
});
