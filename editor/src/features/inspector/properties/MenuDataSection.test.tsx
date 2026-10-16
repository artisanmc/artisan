import { menusOf } from "@/domain/documents";
import type { ContextInput, Menu, SourceRef } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
// Unified data section: the item set block lives inside each list card of the
// menu panel. This suite covers the exported pieces — extractArgTokens (used
// by PreviewContextSection) and MenuSetBlock (create / delete a menu-level set).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MenuSetBlock, extractArgTokens } from "./MenuDataSection";

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

describe("MenuSetBlock", () => {
  beforeEach(() => {
    useServerDataSourcesStore.setState({
      sources: [{ ref: "quests:list", moduleId: "quests", schema: [], schemaHint: null }],
      status: "ready",
      loadedKey: "u:n1/sk1",
    } as never);
    useProjectsStore.setState((s) => ({
      ...s,
      openProjects: {
        ...s.openProjects,
        projects: [
          {
            id: "p1",
            name: "P",
            source: "user_created",
            createdAt: "",
            updatedAt: "",
            defaultLang: "en",
            i18nKeys: {},
            documents: {
              menu: [structuredClone(menu)],
              command: [],
              dialog: [],
            },
            dataSources: [],
            dataModels: [],
            canvasLayout: {},
            canvasEdges: {},
          } as never,
        ],
      },
    }));
  });

  const menuNow = () =>
    menusOf(
      useProjectsStore.getState().openProjects.projects.find((p) => p.id === ("p1" as never))!,
    )[0]!;

  it("creates the menu-level item set (paginated) from the choice buttons", () => {
    render(<MenuSetBlock projectId={"p1" as never} menu={menu} input={sourceInput} />);
    fireEvent.click(screen.getByText("Paginer"));
    const created = menuNow()
      .layers.flatMap((l) => l.elements)
      .find((e) => e.iterates?.source === "quests");
    expect(created).toBeDefined();
    expect(created!.iterates).toEqual({ source: "quests", alias: "item" });
    expect(created!.display).toBeDefined();
  });

  it("deleting the set returns to the paginate/place choice", () => {
    const { rerender } = render(
      <MenuSetBlock projectId={"p1" as never} menu={menu} input={sourceInput} />,
    );
    fireEvent.click(screen.getByText("Paginer"));
    rerender(
      <MenuSetBlock projectId={"p1" as never} menu={menuNow() as never} input={sourceInput} />,
    );
    fireEvent.click(screen.getByText(/Supprimer le set/));
    expect(
      menuNow()
        .layers.flatMap((l) => l.elements)
        .find((e) => e.iterates?.source === "quests"),
    ).toBeUndefined();
    rerender(
      <MenuSetBlock projectId={"p1" as never} menu={menuNow() as never} input={sourceInput} />,
    );
    expect(screen.getByText("Paginer")).toBeInTheDocument();
  });
});
