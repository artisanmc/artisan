import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsersList } from "./UsersList";

const USERS = [
  {
    id: "u1",
    email: "ana@example.com",
    name: "Ana Admin",
    avatarUrl: null,
    editorLanguage: null,
    theme: null,
    isAdmin: true,
    hasPassword: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  },
  {
    id: "u2",
    email: "bob@example.com",
    name: "Bob Builder",
    avatarUrl: null,
    editorLanguage: null,
    theme: null,
    isAdmin: false,
    hasPassword: false,
    createdAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
  },
];

vi.mock("@/lib/api/adminUsers", () => ({
  listAdminUsers: vi.fn(async (q: string) =>
    q ? USERS.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) : USERS,
  ),
}));

afterEach(() => vi.clearAllMocks());

describe("UsersList", () => {
  it("lists users with name, email and an admin badge", async () => {
    render(<UsersList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("Ana Admin")).toBeTruthy());
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Bob Builder")).toBeTruthy();
    expect(screen.getAllByText(/^Admin$/).length).toBe(1); // badge only on Ana
  });

  it("re-queries with the typed search text", async () => {
    const { listAdminUsers } = await import("@/lib/api/adminUsers");
    render(<UsersList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("Ana Admin")).toBeTruthy());

    await userEvent.type(screen.getByRole("searchbox"), "bob");
    await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith("bob"));
    await waitFor(() => expect(screen.queryByText("Ana Admin")).toBeNull());
    expect(screen.getByText("Bob Builder")).toBeTruthy();
  });

  it("shows an empty state when nothing matches", async () => {
    render(<UsersList onSelect={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    await waitFor(() => expect(screen.getByText(/no users|aucun utilisateur/i)).toBeTruthy());
  });

  it("clicking a row selects that user", async () => {
    const onSelect = vi.fn();
    render(<UsersList onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText("Bob Builder")).toBeTruthy());
    await userEvent.click(screen.getByText("Bob Builder"));
    expect(onSelect).toHaveBeenCalledWith("u2");
  });
});
