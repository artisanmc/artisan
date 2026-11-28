import "@/i18n";
import type { OpenProjects, Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HudEditor } from "./HudEditor";
import { type Hud, hudFromFile } from "./hud";

const PID = "p1" as ProjectId;

function project(huds: Hud[]): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: { menu: [], command: [], dialog: [], hud: huds as never[] },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}

const hud = hudFromFile(
  {
    id: "profile",
    layout: [{ text: "name", x: -50, y: 4, width: 100 }],
    texts: { name: "<white>{player}" },
  },
  { projectId: PID, lang: "fr" },
).doc;

describe("a HUD's page", () => {
  beforeAll(() => i18next.changeLanguage("fr"));
  beforeEach(() => {
    const openProjects: OpenProjects = { projects: [project([hud])], projectOrder: [PID] };
    useProjectsStore.setState({ openProjects });
  });
  const current = () =>
    useProjectsStore.getState().openProjects.projects[0]!.documents.hud?.[0] as unknown as Hud;

  it("names it, its lifetime and its zone, and lists its texts", () => {
    render(<HudEditor projectId={PID} hud={hud} />);
    expect(screen.getByRole("heading", { name: "profile" })).toBeTruthy();
    expect(screen.getByText("Permanent, haut de l'écran")).toBeTruthy();
    expect(screen.getAllByLabelText("name").length).toBeGreaterThan(0);
  });

  it("makes it temporary, then conditional", () => {
    const { rerender } = render(<HudEditor projectId={PID} hud={hud} />);
    fireEvent.click(screen.getByRole("button", { name: "Temporaire" }));
    expect(current().enabled).toBe(false);
    rerender(<HudEditor projectId={PID} hud={current()} />);
    expect(screen.getByText(/show_hud: profile/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Conditionnel" }));
    expect(current().enabled).toBe(true);
    rerender(<HudEditor projectId={PID} hud={current()} />);
    expect(screen.getByText("Seulement si")).toBeTruthy();
  });

  it("moves it above the action bar and checks it on change only", () => {
    render(<HudEditor projectId={PID} hud={hud} />);
    fireEvent.click(screen.getByRole("button", { name: "au-dessus de la barre d'action" }));
    expect(current().slot).toBe("action_bar");
    fireEvent.click(screen.getByRole("button", { name: "au changement" }));
    expect(current().refresh).toBe(0);
  });
});
