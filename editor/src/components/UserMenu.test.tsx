import { useAuthStore } from "@/state/authStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: React.ComponentPropsWithRef<"a"> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    currentUser: { id: "user", name: "Iban", email: "test@example.com", avatarUrl: null },
  });
});

it("names the selected server in the open menu", async () => {
  render(<UserMenu serverLabel="Survival" />);
  const button = await screen.findByRole("button", { name: /Iban/ });
  expect(screen.queryByText("Survival")).not.toBeInTheDocument();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(await screen.findByText("Survival")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /déconnexion/i })).toBeInTheDocument();
});

it("omits the server line without a selected server", async () => {
  render(<UserMenu />);
  fireEvent.keyDown(await screen.findByRole("button", { name: /Iban/ }), { key: "ArrowDown" });
  expect(await screen.findByRole("menu")).toBeInTheDocument();
  expect(screen.queryByText("Survival")).not.toBeInTheDocument();
});
