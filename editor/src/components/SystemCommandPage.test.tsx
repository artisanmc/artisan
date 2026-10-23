import { projectId } from "@/domain/ids";
import { ControlledStepsEditor } from "@/features/inspector/chain/ControlledStepsEditor";
import { parseOverride } from "@/lib/commandOverride";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCommandPage } from "./SystemCommandPage";

vi.mock("@/lib/api/configScreens", () => ({
  configWrite: vi.fn(async () => ({ ok: true })),
  configRead: vi.fn(async () => ({ ok: true, files: [] })),
}));
vi.mock("@/lib/api/playerCommands", () => ({ fetchPlayerCommands: vi.fn(async () => []) }));
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: [] })),
}));

const FOLDER = projectId("p_personal");
const FILE = "command/attribution.open.yaml";

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

/** The folder's form, re-rendered from the store as the board's Properties panel is. */
function Page() {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === FOLDER));
  return project ? (
    <SystemCommandPage
      commandId="attribution:open"
      project={project}
      stepsEditor={ControlledStepsEditor}
    />
  ) : null;
}

/** The override files of the folder's draft, by path under `overrides/`. */
function draftFiles(): Record<string, string> {
  const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === FOLDER);
  return (project?.moduleData?.overrides as { __files?: Record<string, string> })?.__files ?? {};
}

describe("SystemCommandPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
    useUiStore.setState({ activeLang: "fr" });
    useSystemCommandsStore.setState({
      serverId: "sk_1",
      status: "ready",
      commands: [declared],
      folders: [{ folder: FOLDER, ownerModule: "attribution" }],
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
    render(<Page />);
    expect(screen.getByText("/attribution sell")).toBeInTheDocument();
    expect(screen.getByText("Vend un objet")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("artisan.attribution.sell")).toBeNull();
    const edits = screen.getAllByRole("button", { name: "Modifier" });
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]!);
    expect(screen.getByDisplayValue("artisan.attribution.sell")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Replier" })).toHaveLength(2);
  });

  it("fills every field with the module's value and writes each change to the folder's draft", () => {
    render(<Page />);
    expect(screen.getByDisplayValue("artisan.attribution")).toBeInTheDocument();
    expect(screen.getByDisplayValue("attribution")).toBeInTheDocument();
    expect(screen.getByDisplayValue("parrain")).toBeInTheDocument();
    expect(screen.getByText("Ouvre le parrainage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(draftFiles()[FILE]).toBe(
      `schema: command_override/v1\ncommand: attribution:open\nenabled: false\n${commented}`,
    );
  });

  it("keeps what is typed while the file holds its normalized form", () => {
    render(<Page />);
    fireEvent.change(screen.getByDisplayValue("parrain"), { target: { value: "p," } });
    expect(screen.getByDisplayValue("p,")).toBeInTheDocument();
    expect(draftFiles()[FILE]).toContain("aliases:\n  - p\n");
  });

  it("edits a text in the topbar's language only, the others kept as they are", () => {
    useSystemCommandsStore.setState({
      commands: [
        { ...declared, description: { fr: "Ouvre le parrainage", en: "Opens referrals" } },
      ],
    });
    useUiStore.setState({ activeLang: "en" });
    render(<Page />);
    expect(screen.queryByRole("button", { name: "Description (fr)" })).toBeNull();
    expect(screen.queryByText("Ouvre le parrainage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Description (en)" }));
    fireEvent.change(screen.getByDisplayValue("Opens referrals"), {
      target: { value: "Open referrals" },
    });
    expect(draftFiles()[FILE]).toContain(
      "description:\n  fr: Ouvre le parrainage\n  en: Open referrals\n",
    );
  });

  it("replaces the module's code with steps that start by calling it, and goes back to it", () => {
    render(<Page />);
    expect(screen.getByText("Le code du module s'exécute.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Personnaliser" }));
    expect(screen.getByText("modifié")).toBeInTheDocument();
    expect(draftFiles()[FILE]).toContain(
      "steps:\n  - module_command:\n      command: attribution:open\n",
    );
    fireEvent.click(screen.getByRole("button", { name: "Revenir au code du module" }));
    expect(screen.getByText("Le code du module s'exécute.")).toBeInTheDocument();
    expect(draftFiles()[FILE]).not.toContain("steps:");
  });

  it("puts the root's name in the header and its card, renamed as typed", () => {
    render(<Page />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    fireEvent.change(screen.getByDisplayValue("attribution"), { target: { value: "parrainage" } });
    expect(screen.getByRole("heading", { level: 2, name: "/parrainage" })).toBeInTheDocument();
    expect(screen.getAllByText("/parrainage")).toHaveLength(2);
    expect(screen.getAllByText("attribution:open")).toHaveLength(2);
  });

  it("turns a field's reset on only while it differs from the module, and puts the value back", () => {
    render(<Page />);
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
  });

  it("reads the override the folder's draft holds, and rewrites it with the module's values as comments", () => {
    useProjectsStore.getState().setModuleData(FOLDER, "overrides", {
      __files: {
        [FILE]: "schema: command_override/v1\ncommand: attribution:open\nenabled: false\n",
      },
    });
    // The server's disk still has another version: the draft wins for its own folder.
    useSystemCommandsStore.setState({
      overrides: {
        "attribution:open": parseOverride(
          FOLDER,
          `overrides/${FILE}`,
          "schema: command_override/v1\ncommand: attribution:open\npermission: x\n",
        )!,
      },
    });
    render(<Page />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux valeurs du module" }));
    expect(draftFiles()[FILE]).toBe(
      `schema: command_override/v1\ncommand: attribution:open\n${commented}`,
    );
  });
});
