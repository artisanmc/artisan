import { useAuthStore } from "@/state/authStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSidebar } from "./AdminSidebar";

const mockPathname = vi.hoisted(() => ({ current: "/admin" }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select?: (s: unknown) => unknown } = {}) => {
      const state = { location: { pathname: mockPathname.current } };
      return select ? select(state) : state;
    },
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe("AdminSidebar", () => {
  beforeEach(() => {
    mockPathname.current = "/admin";
    useAuthStore.setState({
      currentUser: { id: "u1", email: "a@b.c", name: "Iban", isAdmin: true },
      isLoading: false,
    } as any);
  });

  it("renders the back-to-editor link pointing at /networks", () => {
    render(<AdminSidebar />);
    const back = screen.getByRole("link", { name: /retour à l'éditeur|back to editor/i });
    expect(back).toHaveAttribute("href", "/networks");
  });

  it("renders the AI, Users and Design system nav entries", () => {
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: /^IA$|^AI$/ })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: /utilisateurs|users/i })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByRole("link", { name: /design system/i })).toHaveAttribute(
      "href",
      "/admin/design",
    );
  });

  it("keeps the Users entry active on a user profile subpage", () => {
    mockPathname.current = "/admin/users/u123";
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: /utilisateurs|users/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^IA$|^AI$/ })).not.toHaveAttribute("aria-current");
  });

  it("marks the AI entry active on /admin", () => {
    mockPathname.current = "/admin";
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: /^IA$|^AI$/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /design system/i })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the Design entry active on /admin/design", () => {
    mockPathname.current = "/admin/design";
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: /design system/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^IA$|^AI$/ })).not.toHaveAttribute("aria-current");
  });

  it("renders the user menu pill at the bottom", () => {
    render(<AdminSidebar />);
    expect(screen.getByText("Iban")).toBeInTheDocument();
  });
});
