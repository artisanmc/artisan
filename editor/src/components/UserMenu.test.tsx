import { getSubscription } from "@/lib/api/billing";
import { type ServerEditorAccessDto, getServerEditorAccess } from "@/lib/api/projectFiles";
import { useAuthStore } from "@/state/authStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";

vi.mock("@/lib/api/billing", () => ({ getSubscription: vi.fn() }));
vi.mock("@/lib/api/projectFiles", () => ({ getServerEditorAccess: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: React.ComponentPropsWithRef<"a"> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    currentUser: { id: "user", name: "Iban", email: "test@example.com", isAdmin: false },
  });
});

it("loads the selected server usage without an open project", async () => {
  vi.mocked(getSubscription).mockResolvedValue({ status: null });
  vi.mocked(getServerEditorAccess).mockResolvedValue({
    enabled: true,
    quota: 10,
    proUntil: null,
    inventoryAvailable: true,
    count: 4,
    reason: null,
  });
  render(<UserMenu networkId="network" serverId="server" serverLabel="Survival" />);
  const button = await screen.findByRole("button", { name: /Iban.*Free/ });
  expect(getServerEditorAccess).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(await screen.findByRole("status")).toHaveTextContent("4 / 10 ressources personnelles");
  expect(screen.getByText("Survival")).toBeInTheDocument();
  expect(getServerEditorAccess).toHaveBeenCalledWith("network", "server");
});

it("shows the current network plan in the user button", async () => {
  vi.mocked(getSubscription).mockResolvedValue({ status: "active", planName: "Pro annuel" });
  render(<UserMenu networkId="network" />);
  expect(await screen.findByRole("button", { name: /Iban.*Pro annuel/ })).toBeInTheDocument();
});

it("ignores a late inventory response from the previously selected server", async () => {
  vi.mocked(getSubscription).mockResolvedValue({ status: null });
  let resolveFirst!: (value: ServerEditorAccessDto) => void;
  vi.mocked(getServerEditorAccess).mockImplementation((_network, server) =>
    server === "first"
      ? new Promise((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve({
          enabled: true,
          quota: 10,
          proUntil: null,
          inventoryAvailable: true,
          count: 7,
          reason: null,
        }),
  );
  const { rerender } = render(<UserMenu networkId="network" serverId="first" />);
  fireEvent.keyDown(await screen.findByRole("button", { name: /Iban.*Free/ }), {
    key: "ArrowDown",
  });
  rerender(<UserMenu networkId="network" serverId="second" />);
  expect(await screen.findByRole("status")).toHaveTextContent("7 / 10");
  await act(async () =>
    resolveFirst({
      enabled: true,
      quota: 10,
      proUntil: null,
      inventoryAvailable: true,
      count: 1,
      reason: null,
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("7 / 10");
  rerender(<UserMenu networkId="network" />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows unavailable inventory instead of zero and allows retrying", async () => {
  vi.mocked(getSubscription).mockResolvedValue({ status: null });
  vi.mocked(getServerEditorAccess)
    .mockResolvedValueOnce({
      enabled: true,
      quota: 10,
      proUntil: null,
      inventoryAvailable: false,
      count: null,
      reason: "inventory_unavailable",
    })
    .mockResolvedValueOnce({
      enabled: true,
      quota: 10,
      proUntil: null,
      inventoryAvailable: true,
      count: 0,
      reason: null,
    });
  render(<UserMenu networkId="network" serverId="offline" />);
  fireEvent.keyDown(await screen.findByRole("button", { name: /Iban.*Free/ }), {
    key: "ArrowDown",
  });
  expect(await screen.findByRole("alert")).not.toHaveTextContent("0 / 10");
  fireEvent.click(screen.getByRole("button", { name: /réessayer/i }));
  expect(await screen.findByRole("status")).toHaveTextContent("0 / 10");
});

it("does not keep another network's plan when the selection changes", async () => {
  vi.mocked(getSubscription).mockResolvedValueOnce({ status: "active", planName: "Custom" });
  const { rerender } = render(<UserMenu networkId="first" />);
  expect(await screen.findByText("Custom")).toBeInTheDocument();
  vi.mocked(getSubscription).mockResolvedValueOnce({ status: null });
  rerender(<UserMenu networkId="second" />);
  expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  expect(await screen.findByText("Free")).toBeInTheDocument();
});

it("does not claim Free when the subscription cannot be loaded", async () => {
  vi.mocked(getSubscription).mockResolvedValue(null);
  render(<UserMenu networkId="network" />);
  expect(screen.queryByText("Free")).not.toBeInTheDocument();
});
