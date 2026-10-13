import * as networksApi from "@/lib/api/networks";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NetworkDetailPage } from "./networks.$networkId";

vi.mock("@/lib/selfHosted", () => ({ SELF_HOSTED: true, LOCAL_ID: "local" }));

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ currentUser: { id: "u1" }, isLoading: false }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    useParams: () => ({ networkId: "local" }),
    useNavigate: () => vi.fn(),
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

describe("NetworkDetailPage served by the plugin", () => {
  it("sends back to the landing server instead of the cloud management page", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "local", name: "Hub", tier: "free" },
      projects: [],
      serverKeys: [{ id: "local", label: "Hub" }],
    });
    render(<NetworkDetailPage />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent("/");
    expect(screen.queryByText("Hub")).toBeNull();
  });
});
