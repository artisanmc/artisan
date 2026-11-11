import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) => (
      <a {...(rest as any)}>{children}</a>
    ),
  };
});

import { SettingsRoute } from "./settings";

describe("SettingsRoute", () => {
  it("renders the Apparence section by default", () => {
    render(<SettingsRoute />);
    expect(screen.getAllByText(/Apparence|Appearance/i).length).toBeGreaterThan(0);
  });

  it("renders the sections sidebar nav", () => {
    render(<SettingsRoute />);
    expect(screen.getByRole("navigation", { name: /Settings sections/i })).toBeInTheDocument();
  });
});
