import { createNetwork, listNetworks } from "@/lib/api/networks";
import { useAuthStore } from "@/state/authStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ClaimDialog } from "./DemoWorkspace";
import { finishDemoClaim } from "./demoLifecycle";
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/features/project/ProjectWorkspace", () => ({ ProjectCanvasPage: () => null }));
vi.mock("@/lib/api/networks", () => ({ createNetwork: vi.fn(), listNetworks: vi.fn() }));
vi.mock("./demoLifecycle", () => ({ finishDemoClaim: vi.fn(), getPendingDemoClaim: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  vi.mocked(listNetworks).mockResolvedValue([{ id: "network", name: "Network", tier: "free" }]);
});
test("claim navigates to the folder ID in the selected Network", async () => {
  vi.mocked(finishDemoClaim).mockResolvedValue({ projectId: "immutable", networkId: "network", urlId: "demo-kept" });
  render(<ClaimDialog open onOpenChange={() => {}} />);
  await screen.findByRole("option", { name: "Network" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "network" } });
  fireEvent.click(screen.getByRole("button", { name: "demo.claim" }));
  await waitFor(() => expect(finishDemoClaim).toHaveBeenCalledWith("network"));
  expect(navigate).toHaveBeenCalledWith({
    to: "/networks/$networkId/projects/$projectId",
    params: { networkId: "network", projectId: "demo-kept" },
  });
});
test("unknown Network creation response refreshes choices without creating twice", async () => {
  vi.mocked(createNetwork).mockRejectedValue(new TypeError("offline"));
  render(<ClaimDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "My Network" } });
  fireEvent.click(screen.getByRole("button", { name: "demo.createNetwork" }));
  await screen.findByRole("alert");
  expect(createNetwork).toHaveBeenCalledTimes(1);
  expect(listNetworks).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "demo.createNetwork" })).toBeNull();
});
