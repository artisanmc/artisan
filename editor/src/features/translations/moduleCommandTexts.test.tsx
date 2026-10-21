import { projectId } from "@/domain/ids";
import { configWrite } from "@/lib/api/configScreens";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { parseOverride } from "@/lib/commandOverride";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { TranslationPanelContent } from "./TranslationPanel";

vi.mock("@/lib/api/configScreens", () => ({
  configWrite: vi.fn(async () => ({ ok: true })),
  configRead: vi.fn(async () => ({ ok: true, files: [] })),
}));

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
      textDrafts: {},
      load: vi.fn(async () => {}),
    });
  });

  it("lists a module command's description in the folder's languages, missing where untranslated", () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    expect(screen.getByText("/daily · description")).toBeInTheDocument();
    expect(screen.getByText("Claim your reward")).toBeInTheDocument();
  });

  it("writes an edited text to the command's override file, the rest of the file kept", async () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    const row = screen.getByText("/daily · description").closest("li") as HTMLElement;
    fireEvent.click(row.querySelector("[data-testid=copy-default-value]") as HTMLElement);
    expect(
      screen.getByText(/1 command text changed|1 texte de commande modifié/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Save command texts|Enregistrer les textes des commandes/,
      }),
    );
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    const [server, request] = vi.mocked(configWrite).mock.calls[0]!;
    expect(server).toBe("sk_1");
    expect(request.projectId).toBe(PERSONAL);
    expect(request.files[0]?.path).toBe("overrides/command/daily.claim.yaml");
    expect(parse(request.files[0]?.content ?? "")).toEqual({
      schema: "command_override/v1",
      command: "daily:claim",
      enabled: false,
      description: {
        en: "Claim your reward",
        fr: "Récupère ta récompense",
        de: "Claim your reward",
      },
    });
    await waitFor(() => expect(useSystemCommandsStore.getState().textDrafts).toEqual({}));
  });
});
