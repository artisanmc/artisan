import { useAuthStore } from "@/state/authStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfile } from "./UserProfile";

const PROFILE = {
  id: "u2",
  email: "bob@example.com",
  name: "Bob Builder",
  avatarUrl: null,
  editorLanguage: null,
  theme: null,
  isAdmin: false,
  hasPassword: true,
  createdAt: "2026-06-02T00:00:00Z",
  updatedAt: "2026-06-02T00:00:00Z",
  networks: [{ id: "n1", name: "Survie", slug: "survie", role: "owner" }],
};

vi.mock("@/lib/api/adminUsers", () => ({
  getAdminUser: vi.fn(async () => PROFILE),
  updateAdminUser: vi.fn(async () => ({ ok: true, data: { ...PROFILE, name: "Bob R." } })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: null } as never);
});

function setAdmin(id = "admin1") {
  useAuthStore.setState({
    currentUser: { id, email: "root@x.y", name: "Root", isAdmin: true },
  } as never);
}

describe("UserProfile", () => {
  it("prefills the editable fields and shows the user's networks", async () => {
    setAdmin();
    render(<UserProfile userId="u2" />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /name|nom/i })).toHaveValue("Bob Builder"),
    );
    expect(screen.getByRole("textbox", { name: /email/i })).toHaveValue("bob@example.com");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("Survie")).toBeTruthy();
    expect(screen.getByText(/owner/i)).toBeTruthy();
  });

  it("saves only the fields that changed", async () => {
    setAdmin();
    const { updateAdminUser } = await import("@/lib/api/adminUsers");
    render(<UserProfile userId="u2" />);
    const nameInput = await screen.findByRole("textbox", { name: /name|nom/i });

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Bob R.");
    await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));

    await waitFor(() => expect(updateAdminUser).toHaveBeenCalledWith("u2", { name: "Bob R." }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows a translated error when the email is already taken", async () => {
    setAdmin();
    const { updateAdminUser } = await import("@/lib/api/adminUsers");
    vi.mocked(updateAdminUser).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "email_taken",
    });
    render(<UserProfile userId="u2" />);
    const emailInput = await screen.findByRole("textbox", { name: /email/i });

    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, "ana@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const msg = vi.mocked(toast.error).mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/already|déjà/i);
  });

  it("disables the admin toggle on the admin's own profile", async () => {
    setAdmin("u2"); // viewing yourself
    render(<UserProfile userId="u2" />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeDisabled());
  });
});
