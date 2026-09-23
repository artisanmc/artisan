import * as authStore from "@/state/authStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRoute } from "./index";

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

  it("keeps the public landing visible and links to the authenticated workspace", async () => {
    vi.mocked(authStore.useAuthStore).mockImplementation(
      (
        selector: (s: {
          currentUser: { id: string; email: string; name: string } | null;
        }) => unknown,
      ) =>
        selector({
          currentUser: { id: "u1", email: "test@example.com", name: "Test User" },
        }) as any,
    );

    render(<HomeRoute />);

    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/networks"),
    ).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers a demo and sign-in without redirecting a guest", async () => {
    vi.mocked(authStore.useAuthStore).mockImplementation(
      (selector: (s: { currentUser: null }) => unknown) => selector({ currentUser: null }) as any,
    );

    render(<HomeRoute />);

    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/demo")).toBe(
      true,
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keeps public content visible while authentication is unavailable", () => {
    vi.mocked(authStore.useAuthStore).mockImplementation((selector: any) =>
      selector({ currentUser: null, isLoading: true, backendUnreachable: true }),
    );
    render(<HomeRoute />);
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    for (const href of ["/demo", "/pricing", "/signup", "/wiki/"]) {
      expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === href)).toBe(
        true,
      );
    }
  });
});
