import type {
  Action,
  CommandId,
  ElementId,
  Menu,
  MenuId,
  Project,
  ProjectId,
  SourceRef,
} from "@/domain/types";
import type { DeclaredCommand } from "@/lib/api/playerCommands";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerPlayerCommandsStore } from "@/state/serverPlayerCommandsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionEditor, ActionScopeProvider } from "./ActionEditor";

const PID = "p1" as ProjectId;

function project(): Project {
  return {
    id: PID,
    name: "p1",
    source: "user_created",
    createdAt: "2026-09-19",
    updatedAt: "2026-09-19",
    documents: {
      menu: [
        {
          id: "shop_category" as MenuId,
          projectId: PID,
          title: [],
          rows: 6,
          layers: [
            {
              id: "l1" as Menu["layers"][number]["id"],
              name: "default",
              elements: [
                {
                  id: "grid" as ElementId,
                  positions: "",
                  display: {},
                  states: [],
                  places: { source: "items", alias: "item", keyField: "id", placements: [] },
                },
              ],
            },
          ],
          contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as SourceRef }],
        },
      ],
      command: [
        {
          id: "give" as CommandId,
          projectId: PID,
          name: "give",
          arguments: [{ name: "target", type: "player", required: true }],
          steps: [],
        },
      ],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "fr",
    canvasLayout: {},
  };
}

const command: Action = { name: "run_command", value: { command: "", as: "console" } };

function typeBrace() {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "{", selectionStart: 1 } });
}

describe("ActionEditor placeholders", () => {
  beforeEach(() => {
    useProjectsStore.setState({
      openProjects: { projectOrder: [PID], projects: [project()] },
    } as never);
    useServerDataSourcesStore.setState({
      sources: [
        {
          ref: "boutique:items",
          moduleId: "boutique",
          schemaHint: null,
          schema: [{ name: "final_price", type: "integer" }] as never,
        },
      ],
    });
  });

  it("autocompletes a click action's command from the lore catalog, with the hint and no insert bar", () => {
    render(
      <ActionEditor
        projectId={PID}
        action={command}
        onChange={vi.fn()}
        menuId={"shop_category" as MenuId}
        elementId={"grid" as ElementId}
        clickType="left"
      />,
    );
    expect(screen.getByText("Tape « { » pour insérer une variable")).toBeInTheDocument();
    expect(screen.queryByText("insérer :")).toBeNull();
    typeBrace();
    expect(screen.getByRole("option", { name: /item\.final_price/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^\{?slot/ })).toBeNull();
  });

  it("offers a command's arguments inside its actions", () => {
    render(
      <ActionScopeProvider value={{ kind: "command", commandId: "give" as CommandId }}>
        <ActionEditor projectId={PID} action={command} onChange={vi.fn()} />
      </ActionScopeProvider>,
    );
    typeBrace();
    expect(screen.getByRole("option", { name: /target\.name/ })).toBeInTheDocument();
  });
});

describe("ActionEditor — module_command", () => {
  const auction: DeclaredCommand = {
    id: "auctions:ah.auction",
    moduleId: "auctions",
    name: "auction",
    arguments: [
      { name: "price", type: "int", required: true, values: [] },
      { name: "duration", type: "text", required: false, values: [] },
    ],
    children: [],
  };
  beforeEach(() => {
    useProjectsStore.setState({
      openProjects: { projectOrder: [PID], projects: [project()] },
    } as never);
    useServerActionsStore.setState({
      actions: [
        {
          name: "module_command",
          moduleId: null,
          primary: "command",
          args: [
            { name: "command", type: { kind: "string" }, required: true },
            { name: "args", type: { kind: "map", of: { kind: "string" } } },
          ],
        },
      ],
    });
    useServerPlayerCommandsStore.setState({
      commands: [{ ...auction, id: "auctions:ah", name: "ah", arguments: [], children: [auction] }],
    });
  });

  it("lists the declared arguments, empty ones passing what was typed", () => {
    const onChange = vi.fn();
    render(
      <ActionEditor
        projectId={PID}
        action={{
          name: "module_command",
          value: { command: "auctions:ah.auction", args: { x: "1" } },
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox", { name: "command" })).toHaveValue("auctions:ah.auction");
    expect(screen.getByText("price *")).toBeInTheDocument();
    expect(screen.getByText(": integer")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("vide : la valeur tapée pour {price}")).toBeInTheDocument();
    expect(screen.getByText("(non lu par le module)")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("vide : la valeur tapée pour {duration}"), {
      target: { value: "2h" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      name: "module_command",
      value: { command: "auctions:ah.auction", args: { x: "1", duration: "2h" } },
    });
  });

  it("keeps the JSON form for a command no module declares", () => {
    render(
      <ActionEditor
        projectId={PID}
        action={{ name: "module_command", value: { command: "gone:cmd" } }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Aucun module du serveur connecté ne déclare cette commande/),
    ).toBeInTheDocument();
  });
});
