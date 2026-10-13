import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentTree } from "./ProjectDocumentTree";

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      { id: "m1", projectId: PID, title: [], rows: 3, layers: [] },
      { id: "m2", projectId: PID, title: [], rows: 3, layers: [] },
    ],
    commands: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] }],
    dialogs: [],
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "a" as never, projects: [project()], projectOrder: [PID] },
  } as never);
});

describe("ProjectDocumentTree", () => {
  it("lists the documents by category", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
  });

  it("carries one icon per category, not one per document", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    const menus = screen.getByRole("list", { name: /menus/i });
    expect(within(menus).getAllByRole("button", { name: /^m\d$/ })).toHaveLength(2);
    for (const row of within(menus).getAllByRole("button", { name: /^m\d$/ })) {
      expect(row.querySelector("svg")).toBeNull();
    }
    const heading = screen.getByText(/^menus$/i);
    expect(heading.parentElement?.querySelector("svg")).not.toBeNull();
  });

  it("opens a document on click", () => {
    const onOpen = vi.fn();
    render(<ProjectDocumentTree projectId={PID} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("/heal"));
    expect(onOpen).toHaveBeenCalledWith("c1");
  });

  it("the root row opens the project settings without selecting anything", () => {
    useSelectionStore.getState().set(["m1" as never]);
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-settings"));
    expect(useUiStore.getState().projectSettingsOpen).toBe(true);
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });

  it("offers to create a menu, a command and a dialog", async () => {
    const user = userEvent.setup();
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    await user.click(screen.getByTestId("project-create"));
    expect(screen.getByText(/Nouveau menu|New menu/i)).toBeInTheDocument();
    expect(screen.getByText(/Nouvelle commande|New command/i)).toBeInTheDocument();
    expect(screen.getByText(/Nouveau dialogue|New dialog/i)).toBeInTheDocument();
  });
});
