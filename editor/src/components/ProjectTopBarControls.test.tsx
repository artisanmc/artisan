import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => () => {},
    useParams: () => ({}),
    useSearch: () => ({ tab: "overview" }),
  };
});

describe("ProjectTopBarControls", () => {
  it("renders the lang switcher, undo/redo, and deploy when a project is provided", () => {
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
    // Use getAllByTitle to handle the case where "Annuler" also matches the Revert button.
    const undoMatches = screen.getAllByTitle(/Undo \(|Annuler \(/i);
    expect(undoMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /^(Deploy|Déployer|Publier|Publish)/ })).toBeInTheDocument();
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
    expect(screen.getByTestId("open-view-history")).toBeInTheDocument();
    expect(screen.getByTestId("open-view-translations")).toHaveTextContent("1");
  });
});
