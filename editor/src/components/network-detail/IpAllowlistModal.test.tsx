import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IpAllowlistModal } from "./IpAllowlistModal";
import * as networksApi from "@/lib/api/networks";

describe("IpAllowlistModal", () => {
  it("renders allowlist and lets user add/remove an IP", async () => {
    vi.spyOn(networksApi, "getServerKeyAllowlist").mockResolvedValue(["1.2.3.4"]);
    const setSpy = vi
      .spyOn(networksApi, "setServerKeyAllowlist")
      .mockImplementation(async (_n, _k, list) => list);
    render(
      <IpAllowlistModal open onOpenChange={() => {}} networkId="n1" serverId="sk1" />,
    );
    await screen.findByText("1.2.3.4");
    fireEvent.change(screen.getByPlaceholderText("203.0.113.42"), {
      target: { value: "5.6.7.8" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add|ajouter/i }));
    await waitFor(() =>
      expect(setSpy).toHaveBeenCalledWith("n1", "sk1", ["1.2.3.4", "5.6.7.8"]),
    );
  });
});
