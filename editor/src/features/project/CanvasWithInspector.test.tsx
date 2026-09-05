import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/canvas/FloatingEditorPane", () => ({
  FloatingEditorPane: () => <div data-testid="inspector" />,
}));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="inspector" />,
}));

import { CanvasWithInspector } from "./CanvasWithInspector";

const PID = "p1" as ProjectId;

function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderIt() {
  return render(
    <CanvasWithInspector
      projectId={PID}
      canvas={<div data-testid="canvas" />}
      mobileSize={200}
      onMobileSizeChange={() => {}}
    />,
  );
}

beforeEach(() => {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(false);
  useAccountStore.setState({
    account: {
      id: "a" as any,
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any],
          commands: [],
          dialogs: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: {},
          defaultLang: "en",
          canvasLayout: {} as any,
        } as Project,
      ],
    },
  } as any);
});

describe.each([
  ["desktop", true],
  ["mobile", false],
])("CanvasWithInspector — %s", (_label, desktop) => {
  beforeEach(() => setDesktop(desktop));

  /** Le grief de départ : le panneau mangeait de la place en permanence. */
  it("sans sélection, la scène est seule", () => {
    renderIt();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector")).toBeNull();
  });

  it("une sélection fait apparaître l'inspecteur", () => {
    useSelectionStore.getState().set(["m1"]);
    renderIt();
    expect(screen.getByTestId("inspector")).toBeInTheDocument();
  });

  /** Les paramètres du project ne correspondent à aucune sélection. */
  it("les paramètres du project l'ouvrent sans rien sélectionner", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    renderIt();
    expect(screen.getByTestId("inspector")).toBeInTheDocument();
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });

  /**
   * Sinon, désélectionner pour dégager le canvas rouvrirait les paramètres du
   * project au lieu de tout fermer.
   */
  it("sélectionner range les paramètres du project", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    useSelectionStore.getState().set(["m1"]);
    renderIt();
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
  });
});
