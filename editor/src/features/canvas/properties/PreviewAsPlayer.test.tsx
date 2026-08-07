import type { ContextInput, Menu, ProjectId, SourceRef } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewContextSection } from "./PreviewContextSection";

const listOnlinePlayers = vi.fn(async () => ["Alice", "Iban_"]);
vi.mock("@/lib/api/onlinePlayers", () => ({
  listOnlinePlayers: (...a: unknown[]) => listOnlinePlayers(...(a as [])),
}));

/**
 * Data sources are previewed with `player = null`, so a per-player source (quests,
 * homes, balance) renders empty in the canvas until someone is named. This control
 * is what names them — the preview then fetches as that player.
 */
const serverSource: Extract<ContextInput, { kind: "sourceRef" }> = {
  kind: "sourceRef",
  name: "quests",
  ref: "msquests:quests" as SourceRef,
};

const projectSource: Extract<ContextInput, { kind: "sourceRef" }> = {
  kind: "sourceRef",
  name: "ranks",
  ref: "pack:ranks" as SourceRef,
};

const menuWith = (inputs: ContextInput[]) =>
  ({ id: "m1", contextInputs: inputs, layers: [] }) as unknown as Menu;

const renderSection = (menu: Menu) =>
  render(<PreviewContextSection menu={menu} projectId={"p1" as ProjectId} />);

describe("preview as player", () => {
  beforeEach(() => {
    useUiStore.setState({ previewPlayer: "", menuPreviewArgs: {} });
    // The picker only fetches once a server is selected.
    useNetworksStore.setState({ activeId: "n1" } as never);
    useServersStore.setState({ activeServerId: "s1" } as never);
    listOnlinePlayers.mockClear();
    useAccountStore.setState({
      account: {
        projects: [{ id: "p1", menus: [], commands: [], dialogs: [], dataSources: [], i18nKeys: {} }],
      },
    } as unknown as ReturnType<typeof useAccountStore.getState>);
  });

  it("offers the control as soon as the menu reads a live server source", () => {
    renderSection(menuWith([serverSource]));

    expect(screen.getByTestId("preview-as-player")).toBeTruthy();
  });

  it("commits on blur, not on every keystroke — each change refetches the server", () => {
    renderSection(menuWith([serverSource]));
    const field = screen.getByTestId("preview-as-player");

    fireEvent.change(field, { target: { value: "Stev" } });
    expect(useUiStore.getState().previewPlayer).toBe("");

    fireEvent.blur(field, { target: { value: "Steve" } });
    expect(useUiStore.getState().previewPlayer).toBe("Steve");
  });

  it("trims the name — a stray space would miss getPlayerExact", () => {
    renderSection(menuWith([serverSource]));

    fireEvent.blur(screen.getByTestId("preview-as-player"), { target: { value: " Steve " } });

    expect(useUiStore.getState().previewPlayer).toBe("Steve");
  });

  /** Project sources are files, not a live fetcher — no player to preview as. */
  it("stays hidden for a project-owned source", () => {
    renderSection(menuWith([projectSource]));

    expect(screen.queryByTestId("preview-as-player")).toBeNull();
  });

  /** The list is a convenience: it must never become a constraint. */
  it("offers the online players while still accepting a typed name", async () => {
    renderSection(menuWith([serverSource]));
    const field = screen.getByTestId("preview-as-player");

    const listId = field.getAttribute("list");
    expect(listId).toBeTruthy();
    // The names arrive asynchronously from the live server.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(`#${CSS.escape(listId!)} option`)].map((o) =>
          o.getAttribute("value"),
        ),
      ).toEqual(["Alice", "Iban_"]),
    );

    // A name that is not in the list still commits — someone may have just left.
    fireEvent.blur(field, { target: { value: "SomeoneWhoJustLeft" } });
    expect(useUiStore.getState().previewPlayer).toBe("SomeoneWhoJustLeft");
  });

  it("stays hidden when the menu reads nothing at all", () => {
    renderSection(menuWith([]));

    expect(screen.queryByTestId("preview-as-player")).toBeNull();
  });
});
