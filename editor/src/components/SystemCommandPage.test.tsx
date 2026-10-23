import { configWrite } from "@/lib/api/configScreens";
import { createProject } from "@/lib/api/servers";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlledStepsEditor } from "@/features/inspector/chain/ControlledStepsEditor";
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

  it("folds a sub-command into its card, its description as summary, until Edit opens it", () => {
    const sell = {
      ...declared,
      id: "attribution:open.sell",
      name: "sell",
      aliases: [],
      permission: "artisan.attribution.sell",
      description: { fr: "Vend un objet" },
    };
    useSystemCommandsStore.setState({ commands: [{ ...declared, children: [sell] }] });
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
    expect(screen.getByText("/attribution sell")).toBeInTheDocument();
    expect(screen.getByText("Vend un objet")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("artisan.attribution.sell")).toBeNull();
    const edits = screen.getAllByRole("button", { name: "Modifier" });
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]!);
    expect(screen.getByDisplayValue("artisan.attribution.sell")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Replier" })).toHaveLength(2);
  });

  it("fills every field with the module's value and writes only what the admin changed", async () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
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

  it("edits a text in the topbar's language only, the others kept as they are", async () => {
    useSystemCommandsStore.setState({
      commands: [
        { ...declared, description: { fr: "Ouvre le parrainage", en: "Opens referrals" } },
      ],
    });
    useUiStore.setState({ activeLang: "en" });
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
    expect(screen.queryByRole("button", { name: "Description (fr)" })).toBeNull();
    expect(screen.queryByText("Ouvre le parrainage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Description (en)" }));
    const field = screen.getByDisplayValue("Opens referrals");
    fireEvent.change(field, { target: { value: "Open referrals" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    const content = vi.mocked(configWrite).mock.calls[0]![1].files[0]!.content;
    expect(content).toContain("description:\n  fr: Ouvre le parrainage\n  en: Open referrals\n");
    useUiStore.setState({ activeLang: "fr" });
  });

  it("replaces the module's code with steps that start by calling it, and goes back to it", async () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
    expect(screen.getByText("Le code du module s'exécute.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Personnaliser" }));
    expect(screen.getByText("modifié")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    const content = vi.mocked(configWrite).mock.calls[0]![1].files[0]!.content;
    expect(content).toContain("steps:\n  - module_command:\n      command: attribution:open\n");
    fireEvent.click(screen.getByRole("button", { name: "Revenir au code du module" }));
    expect(screen.getByText("Le code du module s'exécute.")).toBeInTheDocument();
  });

  it("puts the root's name in the header and its card, renamed as typed", () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    fireEvent.change(screen.getByDisplayValue("attribution"), { target: { value: "parrainage" } });
    expect(screen.getByRole("heading", { level: 2, name: "/parrainage" })).toBeInTheDocument();
    expect(screen.getAllByText("/parrainage")).toHaveLength(2);
    expect(screen.getAllByText("attribution:open")).toHaveLength(2);
  });

  it("turns a field's reset on only while it differs from the module, and puts the value back", () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
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
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
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
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" stepsEditor={ControlledStepsEditor} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalledWith("sk_1", "attribution");
    expect(vi.mocked(configWrite).mock.calls[0]?.[1].projectId).toBe("attribution");
  });
});
