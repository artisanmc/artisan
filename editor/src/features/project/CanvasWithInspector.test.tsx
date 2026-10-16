import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/inspector/FloatingEditorPane", () => ({
  FloatingEditorPane: () => <div data-testid="inspector" />,
}));
vi.mock("@/features/inspector/EditorPane", () => ({
  EditorPane: () => <div data-testid="inspector" />,
}));

import { CanvasWithInspector } from "./CanvasWithInspector";
import { useProjectLibraryStore } from "./projectLibraryStore";

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
  useProjectLibraryStore.getState().close();
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
          documents: {
            menu: [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any],
            command: [],
            dialog: [],
          },
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

  it("gives the mobile library the inspector space without clearing the selection", () => {
    useSelectionStore.getState().set(["m1"]);
    useProjectLibraryStore.getState().open(PID);
    renderIt();
    expect(screen.queryByTestId("inspector") !== null).toBe(desktop);
    expect([...useSelectionStore.getState().ids]).toEqual(["m1"]);
  });

  /** The original complaint: the panel took up space permanently. */
  it("with no selection, the stage is alone", () => {
    renderIt();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector")).toBeNull();
  });

  it("a selection brings up the inspector", () => {
    useSelectionStore.getState().set(["m1"]);
    renderIt();
    expect(screen.getByTestId("inspector")).toBeInTheDocument();
  });

  /** Project settings match no selection. */
  it("the project settings open it without selecting anything", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    renderIt();
    expect(screen.getByTestId("inspector")).toBeInTheDocument();
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });

  /**
   * Otherwise, deselecting to clear the canvas would reopen the project
   * settings instead of closing everything.
   */
  it("selecting puts away the project settings", () => {
    useUiStore.getState().setProjectSettingsOpen(true);
    useSelectionStore.getState().set(["m1"]);
    renderIt();
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
  });
});
