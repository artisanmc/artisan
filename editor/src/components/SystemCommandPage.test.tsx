import { configWrite } from "@/lib/api/configScreens";
import { createProject } from "@/lib/api/servers";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCommandPage } from "./SystemCommandPage";

vi.mock("@/lib/api/configScreens", () => ({
  configWrite: vi.fn(async () => ({ ok: true })),
  configRead: vi.fn(async () => ({ ok: true, files: [] })),
}));
vi.mock("@/lib/api/servers", () => ({
  createProject: vi.fn(async (_server: string, name: string) => ({ id: name, externalId: name })),
}));
vi.mock("@/lib/api/playerCommands", () => ({ fetchPlayerCommands: vi.fn(async () => []) }));
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: [] })),
}));

const declared = {
  id: "attribution:open",
  moduleId: "attribution",
  name: "attribution",
  aliases: ["parrain"],
  permission: "artisan.attribution",
  description: { fr: "Ouvre le parrainage" },
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
};

describe("SystemCommandPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `load` is what a save re-reads; the test only checks what was written.
    useSystemCommandsStore.setState({
      serverId: "sk_1",
      status: "ready",
      commands: [declared],
      folders: [{ folder: "attribution_config", ownerModule: "attribution" }],
      overrides: {},
      load: vi.fn(async () => {}),
    });
  });

  const commented = [
    "# The module's values. Uncomment a line to change it; delete this file to go back to them.",
    "# name: attribution",
    "# aliases:",
    "#   - parrain",
    "# permission: artisan.attribution",
    "# description:",
    "#   fr: Ouvre le parrainage",
    "",
  ].join("\n");

  it("fills every field with the module's value and writes only what the admin changed", async () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    expect(screen.getByDisplayValue("artisan.attribution")).toBeInTheDocument();
    expect(screen.getByDisplayValue("attribution")).toBeInTheDocument();
    expect(screen.getByDisplayValue("parrain")).toBeInTheDocument();
    expect(screen.getByText("Ouvre le parrainage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    expect(createProject).not.toHaveBeenCalled();
    expect(configWrite).toHaveBeenCalledWith("sk_1", {
      projectId: "attribution_config",
      files: [
        {
          path: "overrides/command/attribution.open.yaml",
          content: `schema: command_override/v1\ncommand: attribution:open\nenabled: false\n${commented}`,
        },
      ],
    });
  });

  it("puts the root's name and id in the header only, renamed as typed", () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    fireEvent.change(screen.getByDisplayValue("attribution"), { target: { value: "parrainage" } });
    expect(screen.getByRole("heading", { level: 2, name: "/parrainage" })).toBeInTheDocument();
    expect(screen.getAllByText("/parrainage")).toHaveLength(1);
    expect(screen.getAllByText("attribution:open")).toHaveLength(1);
  });

  it("turns a field's reset on only while it differs from the module, and puts the value back", () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    const reset = () =>
      screen.getByRole("button", { name: "Permission : revenir à la valeur du module" });
    expect(reset()).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("artisan.attribution"), {
      target: { value: "artisan.other" },
    });
    expect(reset()).toBeEnabled();
    fireEvent.click(reset());
    expect(screen.getByDisplayValue("artisan.attribution")).toBeInTheDocument();
    expect(reset()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("writes the module's values as comments when the form is back to them", async () => {
    useSystemCommandsStore.setState({
      overrides: {
        "attribution:open": {
          command: "attribution:open",
          folder: "lobby",
          path: "overrides/command/open.yaml",
          content: "schema: command_override/v1\ncommand: attribution:open\nenabled: false\n",
          fields: { enabled: false },
          hasLogic: false,
        },
      },
    });
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux valeurs du module" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(configWrite).toHaveBeenCalledWith("sk_1", {
        projectId: "lobby",
        files: [
          {
            path: "overrides/command/open.yaml",
            content: `schema: command_override/v1\ncommand: attribution:open\n${commented}`,
          },
        ],
      }),
    );
  });

  it("creates the module's folder when it has none on this server", async () => {
    useSystemCommandsStore.setState({ folders: [] });
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalledWith("sk_1", "attribution");
    expect(vi.mocked(configWrite).mock.calls[0]?.[1].projectId).toBe("attribution");
  });
});
