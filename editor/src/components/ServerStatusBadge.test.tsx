import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServerStatusBadge } from "./ServerStatusBadge";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

describe("ServerStatusBadge", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders online state when server is up", async () => {
    vi.spyOn(networksApi, "getServerStatus").mockResolvedValue({ online: true });
    render(<ServerStatusBadge networkId="n1" serverKeyId="sk1" projectId="p1" />);
    await screen.findByText(/online|en ligne/i);
  });

  it("renders offline state when server is down", async () => {
    vi.spyOn(networksApi, "getServerStatus").mockResolvedValue({ online: false });
    render(<ServerStatusBadge networkId="n1" serverKeyId="sk1" projectId="p1" />);
    await screen.findByText(/offline|hors-ligne/i);
  });

  it("renders nothing while still loading", () => {
    vi.spyOn(networksApi, "getServerStatus").mockImplementation(() => new Promise(() => {}));
    const { container } = render(<ServerStatusBadge networkId="n1" serverKeyId="sk1" projectId="p1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when networkId is null", () => {
    const { container } = render(<ServerStatusBadge networkId={null} serverKeyId="sk1" projectId="p1" />);
    expect(container.firstChild).toBeNull();
  });
});
