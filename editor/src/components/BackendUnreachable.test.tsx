import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const authState = vi.hoisted(() => ({ hydrate: vi.fn() }));
vi.mock("@/state/authStore", () => ({
  useAuthStore: Object.assign(() => undefined, { getState: () => authState }),
}));

import { BackendUnreachable } from "./BackendUnreachable";

describe("BackendUnreachable", () => {
  it("dit le vrai problème plutôt que d'envoyer sur /login", () => {
    render(<BackendUnreachable />);
    expect(screen.getByText("auth.unreachableTitle")).toBeInTheDocument();
    expect(screen.getByText("auth.unreachableBody")).toBeInTheDocument();
  });

  it("permet de relancer la tentative à la main", async () => {
    authState.hydrate.mockClear();
    render(<BackendUnreachable />);
    await userEvent.click(screen.getByRole("button", { name: "auth.retryNow" }));
    expect(authState.hydrate).toHaveBeenCalled();
  });
});
