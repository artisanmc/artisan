import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => () => {},
    useParams: () => ({}),
    useSearch: () => ({ tab: "overview" }),
  };
});

describe("ProjectTopBarControls", () => {
  it("separates project actions, navigation and canvas tools", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(within(screen.getByTestId("project-header")).getByText("Test")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-header")).getByRole("button", {
        name: /^(Save|Enregistrer)/,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-view-navigation")).getByTestId("open-view-overview"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-editing-tools")).getByTitle(/Undo \(|Annuler \(/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("open-view-overview").querySelector("kbd")).toBeNull();
  });
  it("renders the lang switcher, undo/redo, and save when a project is provided", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    // Make assertions broad — we just want to confirm the trio is in the DOM.
    // Titles may be in English or French depending on test locale.
    const undoMatches = screen.getAllByTitle(/Undo \(|Annuler \(/i);
    expect(undoMatches.length).toBeGreaterThanOrEqual(1);
    // Un seul geste depuis la bascule « disque seul » : Enregistrer a remplacé
    // la paire Déployer / Revenir (ADR `server-disk-only-storage`).
    expect(screen.getByRole("button", { name: /^(Save|Enregistrer)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Deploy|Déployer)/ })).toBeNull();
  });

  it("renders the workspace view buttons with a missing-translations badge", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      // activeLang defaults to the browser lang in tests ("en") — count misses
      // for en: k1 has only fr → 1 missing.
      i18nKeys: { k1: { fr: "Bonjour" }, k2: { en: "Bye", fr: "Au revoir" } },
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(screen.getByTestId("open-view-translations")).toBeInTheDocument();
    expect(screen.getByTestId("open-view-data-sources")).toBeInTheDocument();
    expect(screen.getByTestId("open-view-translations")).toHaveTextContent("1");
  });
});
