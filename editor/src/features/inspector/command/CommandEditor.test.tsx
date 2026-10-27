import { commandNodeAt } from "@/domain/commandNodes";
import { commandsOf } from "@/domain/documents";
import type { Command, CommandId, ProjectId } from "@/domain/types";
import { useCommandNodeStore } from "@/state/commandNodeStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerPlayerCommandsStore } from "@/state/serverPlayerCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CommandEditor } from "./CommandEditor";

const PID = "p1" as ProjectId;
const CID = "ah" as CommandId;

const command = () =>
  commandsOf(useProjectsStore.getState().openProjects.projects[0]!).find((c) => c.id === CID)!;

/** The editor as the inspector mounts it: re-rendered from the store on every change. */
function Live() {
  const cmd = useProjectsStore(
    (s) => commandsOf(s.openProjects.projects[0]!).find((c) => c.id === CID) as Command,
  );
  return <CommandEditor projectId={PID} command={cmd} />;
}

beforeEach(() => {
  useCommandNodeStore.setState({ id: null, path: [] });
  useProjectsStore.setState({
    openProjects: {
      projects: [
        {
          id: PID,
          name: "shop",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          documents: {
            menu: [],
            command: [
              {
                id: CID,
                projectId: PID,
                name: "ah",
                arguments: [],
                steps: [],
                subcommands: [
                  {
                    name: "sell",
                    arguments: [{ name: "price", type: "integer", required: true }],
                    steps: [
                      { kind: "action", action: { name: "module_command", value: "shop:ah.sell" } },
                    ],
                  },
                  {
                    name: "admin",
                    arguments: [],
                    steps: [],
                    subcommands: [{ name: "reload", arguments: [], steps: [] }],
                  },
                ],
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
        },
      ],
      projectOrder: [PID],
    },
    // biome-ignore lint/suspicious/noExplicitAny: partial store seed
  } as any);
  // biome-ignore lint/suspicious/noExplicitAny: partial store seed
  useUiStore.setState({ activeLang: "fr" } as any);
});

describe("CommandEditor — sub-commands", () => {
  it("lists the command and every sub-command as typed", () => {
    render(<Live />);
    for (const typed of ["/ah", "/ah sell", "/ah admin", "/ah admin reload"])
      expect(screen.getByRole("button", { name: typed })).toBeTruthy();
  });

  it("edits the sub-command a row picks, its arguments and its permission", () => {
    render(<Live />);
    fireEvent.click(screen.getByRole("button", { name: "/ah sell" }));
    expect(screen.getByRole("heading", { name: "/ah sell" })).toBeTruthy();
    expect(screen.getByDisplayValue("price")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("(seulement celle du parent)"), {
      target: { value: "ah.sell" },
    });
    expect(commandNodeAt(command(), [0])?.permission).toBe("ah.sell");
    expect(command().permission).toBeUndefined();
  });

  it("adds a sub-command under the selected one and opens it", () => {
    render(<Live />);
    fireEvent.click(screen.getByRole("button", { name: "/ah admin" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Ajouter une sous-commande" }));
    expect(commandNodeAt(command(), [1])?.subcommands?.map((s) => s.name)).toEqual([
      "reload",
      "sub",
    ]);
    expect(screen.getByRole("heading", { name: "/ah admin sub" })).toBeTruthy();
  });

  it("turns a sub-command off with its switch and removes one with its texts", () => {
    render(<Live />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]!);
    expect(commandNodeAt(command(), [0])?.enabled).toBe(false);
    fireEvent.click(screen.getAllByTitle("Supprimer la sous-commande")[0]!);
    expect(command().subcommands?.map((s) => s.name)).toEqual(["admin"]);
  });

  it("selects a sub-command from anywhere on its row, not from its switch", () => {
    render(<Live />);
    const row = screen.getByRole("button", { name: "/ah sell" }).closest("li")!;
    fireEvent.click(row);
    expect(screen.getByRole("heading", { name: "/ah sell" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("switch")[2]!);
    expect(screen.getByRole("heading", { name: "/ah sell" })).toBeTruthy();
    expect(commandNodeAt(command(), [1])?.enabled).toBe(false);
  });

  it("opens on the sub-command a click on the board chose", () => {
    useCommandNodeStore.getState().select(CID, [1, 0]);
    render(<Live />);
    expect(screen.getByRole("heading", { name: "/ah admin reload" })).toBeTruthy();
    act(() => useCommandNodeStore.getState().select(CID, [0]));
    expect(screen.getByRole("heading", { name: "/ah sell" })).toBeTruthy();
  });
});

describe("CommandEditor — a module's arguments", () => {
  beforeEach(() => {
    useServerPlayerCommandsStore.setState({
      commands: [
        {
          id: "shop:ah",
          moduleId: "shop",
          name: "ah",
          arguments: [],
          children: [
            {
              id: "shop:ah.sell",
              moduleId: "shop",
              name: "sell",
              arguments: [{ name: "price", type: "int", required: true, values: [] }],
              children: [],
            },
          ],
        },
      ],
    });
  });

  it("says the module reads them, and warns once one is renamed", () => {
    render(<Live />);
    fireEvent.click(screen.getByRole("button", { name: "/ah sell" }));
    expect(
      screen.getByText(/Le code du module shop \(shop:ah\.sell\) lit ces arguments/),
    ).toBeTruthy();
    expect(screen.getByTitle("Lu par le code du module sous ce nom et ce type")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("price"), { target: { value: "cost" } });
    expect(screen.getByText(/price \(integer\) manque : le module l'exige/)).toBeTruthy();
    expect(screen.getByText("cost n'est pas lu par le module (renommé ?).")).toBeTruthy();
  });
});
