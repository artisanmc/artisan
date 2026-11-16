import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./properties/ProjectProperties", () => ({
  ProjectProperties: () => <div data-testid="project-properties" />,
}));
vi.mock("./command/CommandEditor", () => ({
  CommandEditor: () => <div data-testid="command-editor" />,
}));

import { SelectionInspector } from "./SelectionInspector";

const PID = "p1" as ProjectId;

beforeEach(() => {
  useSelectionStore.getState().clear();
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          documents: {
            menu: [],
            command: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
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

describe("SelectionInspector — the Document of a page", () => {
  it("with nothing selected and no Document, shows the project settings (the panel)", () => {
    render(<SelectionInspector projectId={PID} />);
    expect(screen.getByTestId("project-properties")).toBeInTheDocument();
  });

  it("a page keeps its Document when the selection is cleared (project settings opened beside it)", () => {
    render(<SelectionInspector projectId={PID} document="command/c1" />);
    expect(screen.getByTestId("command-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("project-properties")).toBeNull();
  });
});
