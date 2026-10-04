import "@/i18n";
import "@/state/accountStore";
import "@/state/uiStore";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { papiScopeKey, useServerPapiPlaceholdersStore } from "@/state/serverPapiPlaceholdersStore";
import { useServersStore } from "@/state/serversStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ServerPlaceholderInput } from "./ServerPlaceholderInput";

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c", name: "A", avatarUrl: null } });
  useNetworksStore.setState({ activeId: "n1" });
  useServersStore.setState({ activeServerId: "s1" });
  useServerPapiPlaceholdersStore.setState({
    key: papiScopeKey({ userId: "u1", networkId: "n1", serverId: "s1" }),
    placeholders: [{ placeholder: "%player_name%", expansion: "player" }],
  });
});
afterEach(() => {
  useAuthStore.setState({ currentUser: null });
  useNetworksStore.setState({ activeId: null });
  useServersStore.setState({ activeServerId: null });
  useServerPapiPlaceholdersStore.getState().clear();
});

it("shows the selected server's declarations and hides them immediately after switching servers or signing out", () => {
  render(<ServerPlaceholderInput value="" onChange={() => {}} entries={[]} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "%" } });
  expect(screen.getByText("%player_name%")).toBeInTheDocument();
  act(() => useServersStore.setState({ activeServerId: "s2" }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  act(() => useServersStore.setState({ activeServerId: "s1" }));
  expect(screen.getByText("%player_name%")).toBeInTheDocument();
  act(() => useAuthStore.setState({ currentUser: null }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
