import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import "@/i18n";
import { useAuthStore } from "@/state/authStore";
import { LogoutButton } from "./LogoutButton";

beforeEach(() => {
  useAuthStore.setState({
    currentUser: { id: "u", email: "x@y.z", name: "X", avatarUrl: null },
    isLoading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

describe("LogoutButton", () => {
  test("calls authStore.logout on click", async () => {
    const spy = vi.spyOn(useAuthStore.getState(), "logout").mockResolvedValue();
    render(<LogoutButton apiUrl="http://x" />);
    await userEvent.click(screen.getByRole("button", { name: /sign out|déconnexion/i }));
    expect(spy).toHaveBeenCalledWith("http://x");
  });
});
