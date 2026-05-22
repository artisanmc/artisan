import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { HomeRoute } from "./index";
import * as authStore from "@/state/authStore";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/state/authStore");

describe("HomeRoute", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("redirects authenticated user to /networks", async () => {
    vi.mocked(authStore.useAuthStore).mockImplementation(
      (selector: (s: { currentUser: { id: string; email: string; name: string } | null }) => unknown) =>
        selector({ currentUser: { id: "u1", email: "test@example.com", name: "Test User" } }) as any
    );

    render(<HomeRoute />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/networks",
      });
    });
  });

  it("redirects unauthenticated user to /login", async () => {
    vi.mocked(authStore.useAuthStore).mockImplementation(
      (selector: (s: { currentUser: null }) => unknown) =>
        selector({ currentUser: null }) as any
    );

    render(<HomeRoute />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/login",
      });
    });
  });
});
