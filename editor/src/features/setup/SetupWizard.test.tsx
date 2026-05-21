import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import * as networksApi from "@/lib/api/networks";

// Mock out the router so Link doesn't explode
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, Link: ({ children, ...props }: any) => <a {...props}>{children}</a> };
});

// Stub API so Step1Network's useEffect resolves silently
vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);

describe("SetupWizard", () => {
  it("starts on step 1", () => {
    render(<SetupWizard />);
    expect(screen.getByText(/step 1 of 4/i)).toBeTruthy();
  });

  it("Next is disabled when no network chosen (step 1)", () => {
    render(<SetupWizard />);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });
});
