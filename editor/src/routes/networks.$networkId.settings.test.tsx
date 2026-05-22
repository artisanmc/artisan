import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as api from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "n1" }),
  };
});

describe("/networks/$id/settings — transfer init", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("clicking 'Générer un lien' shows the URL in a readonly input", async () => {
    vi.spyOn(api, "initNetworkTransfer").mockResolvedValue({
      url: "http://localhost:5173/transfer?token=ABC",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const { default: Settings } = await import("./networks.$networkId.settings");
    render(<Settings />);
    fireEvent.click(screen.getByText(/Générer un lien/i));
    const input = await screen.findByDisplayValue(/transfer\?token=ABC/);
    expect((input as HTMLInputElement).readOnly).toBe(true);
  });

  it("error on transfer init shows error message", async () => {
    vi.spyOn(api, "initNetworkTransfer").mockRejectedValue(new Error("boom"));
    const { default: Settings } = await import("./networks.$networkId.settings");
    render(<Settings />);
    fireEvent.click(screen.getByText(/Générer un lien/i));
    await screen.findByText(/Erreur/i);
  });
});
