import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NetworkDetailPage } from "./networks.$networkId";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useParams: () => ({ networkId: "n1" }), Link: ({ children, ...props }: any) => <a {...props}>{children}</a> };
});

describe("NetworkDetailPage", () => {
  it("renders the network detail with packs + serverKeys", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "N1", tier: "free" },
      packs: [{ id: "p1", name: "shop", hash: "h" }],
      serverKeys: [{ id: "sk_1", label: "test-server" }],
    });
    render(<NetworkDetailPage />);
    await waitFor(() => expect(screen.getByText("N1")).toBeTruthy());
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("test-server")).toBeTruthy();
  });
});
