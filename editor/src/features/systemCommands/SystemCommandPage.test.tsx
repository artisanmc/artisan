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

  it("shows the module's values and writes only what the admin changed", async () => {
    render(<SystemCommandPage serverId="sk_1" commandId="attribution:open" />);
    expect(screen.getByPlaceholderText("artisan.attribution")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    expect(createProject).not.toHaveBeenCalled();
    expect(configWrite).toHaveBeenCalledWith("sk_1", {
      projectId: "attribution_config",
      files: [
        {
          path: "overrides/command/attribution.open.yaml",
          content: "schema: command_override/v1\ncommand: attribution:open\nenabled: false\n",
        },
      ],
      deletes: [],
    });
  });

  it("deletes the file when the form is back to the module's values", async () => {
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
        files: [],
        deletes: ["overrides/command/open.yaml"],
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
