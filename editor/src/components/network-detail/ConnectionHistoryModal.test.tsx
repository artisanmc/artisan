import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConnectionHistoryModal } from "./ConnectionHistoryModal";
import * as networksApi from "@/lib/api/networks";

describe("ConnectionHistoryModal", () => {
  it("fetches helloes when opened and renders them", async () => {
    vi.spyOn(networksApi, "listServerKeyHelloes").mockResolvedValue([
      { id: "h1", ip: "1.2.3.4", mcVersion: "1.21.4", helloAt: "2026-06-01T08:00:00Z", rejectedReason: null },
    ]);
    render(<ConnectionHistoryModal open onOpenChange={() => {}} networkId="n1" serverId="sk1" />);
    await waitFor(() => expect(networksApi.listServerKeyHelloes).toHaveBeenCalledWith("n1", "sk1"));
    await screen.findByText("1.2.3.4");
  });
});
