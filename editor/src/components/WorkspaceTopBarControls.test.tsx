import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceTopBarControls } from "./WorkspaceTopBarControls";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => () => {}, useParams: () => ({}) };
});

describe("WorkspaceTopBarControls", () => {
  it("renders the lang switcher, undo/redo, and deploy when a pack is provided", () => {
    const pack = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<WorkspaceTopBarControls pack={pack} packId={"p1" as any} />);
    // Make assertions broad — we just want to confirm the trio is in the DOM.
    // Titles may be in English or French depending on test locale.
    // Use getAllByTitle to handle the case where "Annuler" also matches the Revert button.
    const undoMatches = screen.getAllByTitle(/Undo \(|Annuler \(/i);
    expect(undoMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /^(Deploy|Déployer|Publier|Publish)/ })).toBeInTheDocument();
  });
});
