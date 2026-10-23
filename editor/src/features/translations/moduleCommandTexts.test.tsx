import { projectId } from "@/domain/ids";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { parseOverride } from "@/lib/commandOverride";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { TranslationPanelContent } from "./TranslationPanel";

const PERSONAL = projectId("p_personal");

const claim: PlayerCommand = {
  id: "daily:claim",
  moduleId: "daily",
  name: "daily",
  aliases: [],
  permission: null,
  description: { en: "Claim your reward", fr: "Récupère ta récompense" },
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
};

describe("Translations panel — module command texts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
    useUiStore.getState().setActiveLang("de");
    useSystemCommandsStore.setState({
      serverId: "sk_1",
      status: "ready",
      commands: [claim],
      folders: [{ folder: PERSONAL, ownerModule: "daily" }],
      overrides: {
        "daily:claim": parseOverride(
          PERSONAL,
          "overrides/command/daily.claim.yaml",
          "schema: command_override/v1\ncommand: daily:claim\nenabled: false\n",
        )!,
      },
      load: vi.fn(async () => {}),
    });
  });

  it("lists a module command's description in the folder's languages, missing where untranslated", () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    expect(screen.getByText("/daily · description")).toBeInTheDocument();
    expect(screen.getByText("Claim your reward")).toBeInTheDocument();
  });

  it("writes an edited text to the command's override file in the folder's draft, the rest kept", () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    const row = screen.getByText("/daily · description").closest("li") as HTMLElement;
    fireEvent.click(row.querySelector("[data-testid=copy-default-value]") as HTMLElement);
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PERSONAL);
    const files = (project?.moduleData?.overrides as { __files: Record<string, string> }).__files;
    expect(parse(files["command/daily.claim.yaml"] ?? "")).toEqual({
      schema: "command_override/v1",
      command: "daily:claim",
      enabled: false,
      description: {
        en: "Claim your reward",
        fr: "Récupère ta récompense",
        de: "Claim your reward",
      },
    });
    // The draft speaks for the folder from now on: the row reads the text it holds.
    expect(screen.queryByRole("button", { name: /Save command texts|Enregistrer/ })).toBeNull();
  });
});
