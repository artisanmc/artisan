import { useAuthStore } from "@/state/authStore";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  };
});

vi.mock("@/features/selfHosted/SelfHostedSignIn", () => ({
  SelfHostedSignIn: () => <div data-testid="sign-in" />,
}));

describe("LoginPage", () => {
  it("shows the sign-in card to an anonymous visitor", () => {
    useAuthStore.setState({ currentUser: null });
    render(<LoginPage />);
    expect(screen.getByTestId("sign-in")).toBeInTheDocument();
  });

  it("sends a signed-in user to where they were going", () => {
    window.history.replaceState(null, "", "/login?next=%2Fservers");
    useAuthStore.setState({ currentUser: { id: "u1" } as never });
    render(<LoginPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/servers");
  });
});
