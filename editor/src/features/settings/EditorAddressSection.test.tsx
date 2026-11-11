import { ApiError } from "@/lib/api/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAddressSection } from "./EditorAddressSection";

const api = vi.hoisted(() => ({
  getEditorAddress: vi.fn(),
  checkAddressName: vi.fn(),
  takeAddressName: vi.fn(),
}));
vi.mock("@/lib/api/editorAddress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/editorAddress")>()),
  getEditorAddress: api.getEditorAddress,
  checkAddressName: api.checkAddressName,
  takeAddressName: api.takeAddressName,
}));

const address = {
  tunnel: true,
  connected: true,
  url: "https://mbzo7fhez5ietscu.artisanmc.app",
  name: null,
  names: true,
  suffix: ".artisanmc.app",
};

describe("EditorAddressSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getEditorAddress.mockResolvedValue(address);
    api.checkAddressName.mockResolvedValue(undefined);
  });

  it("checks a name, then takes it and offers the new address signed in", async () => {
    api.takeAddressName.mockResolvedValue({
      name: "survie",
      url: "https://survie.artisanmc.app",
      login: "https://survie.artisanmc.app/login/tok",
    });
    render(<EditorAddressSection />);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Survie" } });
    await waitFor(() => expect(api.checkAddressName).toHaveBeenCalledWith("survie"));
    const take = screen.getByRole("button", { name: /Use this address|Utiliser cette adresse/ });
    await waitFor(() => expect(take).toBeEnabled());
    fireEvent.click(take);
    await waitFor(() => expect(api.takeAddressName).toHaveBeenCalledWith("survie"));
    expect(
      await screen.findByRole("link", { name: /Open the new address|Ouvrir la nouvelle adresse/ }),
    ).toHaveAttribute("href", "https://survie.artisanmc.app/login/tok");
  });

  it("says why a name cannot be taken", async () => {
    api.checkAddressName.mockRejectedValue(new ApiError("taken", 409));
    render(<EditorAddressSection />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "survie" } });
    expect(await screen.findByText(/already taken|déjà pris/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Use this address|Utiliser cette adresse/ }),
    ).toBeDisabled();
  });

  it("refuses a malformed name without asking the hub", async () => {
    render(<EditorAddressSection />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "ab" } });
    expect(await screen.findByText(/Invalid name|Nom invalide/)).toBeInTheDocument();
    expect(api.checkAddressName).not.toHaveBeenCalled();
  });

  it("has nothing to name without a tunnel", async () => {
    api.getEditorAddress.mockResolvedValue({ tunnel: false });
    render(<EditorAddressSection />);
    expect(await screen.findByText(/Nothing to name|Rien à nommer/)).toBeInTheDocument();
  });
});
