import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuDataSection, extractArgTokens } from "./MenuDataSection";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import type { ContextInput, Menu, SourceRef } from "@/domain/types";

const previewDataSource = vi.fn();
vi.mock("@/lib/api/dataSources", async () => {
  const actual = await vi.importActual<object>("@/lib/api/dataSources");
  return { ...actual, previewDataSource: (...a: unknown[]) => previewDataSource(...a) };
});

const sourceInput: Extract<ContextInput, { kind: "sourceRef" }> = {
  kind: "sourceRef",
  name: "quests",
  ref: "quests:list" as SourceRef,
  filter: { group: "{group}" },
  sort: { by: "order", direction: "asc" },
  limit: 10,
};
const menu = {
  id: "m1",
  contextInputs: [sourceInput, { kind: "primitive", name: "group", type: "string" }],
  layers: [],
} as unknown as Menu;

describe("extractArgTokens", () => {
  it("collects {arg} tokens from filter and params values, deduped + sorted", () => {
    expect(
      extractArgTokens({
        ...sourceInput,
        params: { page: "{page}" },
        filter: { group: "{group}", other: "{group}" },
      }),
    ).toEqual(["group", "page"]);
  });
  it("returns [] without tokens", () => {
    expect(extractArgTokens({ ...sourceInput, filter: { group: "daily" } })).toEqual([]);
  });
});

describe("MenuDataSection", () => {
  beforeEach(() => {
    previewDataSource.mockReset();
    useNetworksStore.setState({ activeId: "n1" } as never);
    useServersStore.setState({ activeServerId: "sk1" } as never);
    useServerDataSourcesStore.setState({
      sources: [{ ref: "quests:list", moduleId: "quests", schema: [], schemaHint: null }],
      status: "ready",
      loadedKey: "u:n1/sk1",
    });
  });

  it("renders one card per sourceRef input with ref, module badge and filter summary", () => {
    render(<MenuDataSection menu={menu} />);
    expect(screen.getByText("quests:list")).toBeInTheDocument();
    expect(screen.getByText("quests")).toBeInTheDocument();
    expect(screen.getByText(/group = \{group\}/)).toBeInTheDocument();
  });

  it("previews with the menu's filters and the typed test-arg values", async () => {
    previewDataSource.mockResolvedValue({ ok: true, rows: [{ id: "q1" }], truncated: false });
    render(<MenuDataSection menu={menu} />);
    fireEvent.change(screen.getByTestId("test-arg-group"), { target: { value: "daily" } });
    fireEvent.click(screen.getByTestId("menu-data-preview"));
    await waitFor(() => expect(screen.getByText("q1")).toBeInTheDocument());
    expect(previewDataSource).toHaveBeenCalledWith("n1", "sk1", {
      ref: "quests:list",
      params: undefined,
      filter: { group: "{group}" },
      sort: { by: "order", direction: "asc" },
      limit: 10,
      args: { group: "daily" },
    });
  });

  it("returns null when the menu consumes no source", () => {
    const { container } = render(<MenuDataSection menu={{ ...menu, contextInputs: [] } as Menu} />);
    expect(container.firstChild).toBeNull();
  });
});
