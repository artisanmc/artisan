import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentTree } from "./ProjectDocumentTree";
import { dropDocument, withDropPreview } from "./documentDrag";

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [
        { id: "m1", projectId: PID, title: [], rows: 3, layers: [] },
        { id: "m2", projectId: PID, title: [], rows: 3, layers: [] },
      ],
      command: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] }],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

beforeEach(() => {
  useProjectsStore.setState({
    openProjects: { projects: [project()], projectOrder: [PID] },
  } as never);
});

describe("ProjectDocumentTree", () => {
  it("nests filed documents under their folders, which fold", async () => {
    const filed = project();
    (filed.documents.menu![0] as { folder?: string }).folder = "boutique/armes";
    (filed.documents.command![0] as { folder?: string }).folder = "boutique";
    useProjectsStore.setState({
      openProjects: { projects: [filed], projectOrder: [PID] },
    } as never);
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    const boutique = screen.getByRole("button", { name: "boutique" });
    expect(boutique).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "armes" })).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
    expect(screen.getByText("m2")).toBeInTheDocument();
    await userEvent.setup().click(boutique);
    expect(screen.queryByText("m1")).toBeNull();
    expect(screen.queryByText("/heal")).toBeNull();
    expect(screen.getByText("m2")).toBeInTheDocument();
  });

  it("colors a folder like its board frame, a sub-folder like its top folder's", () => {
    const filed = project();
    (filed.documents.menu![0] as { folder?: string }).folder = "boutique/armes";
    filed.folders = { boutique: { color: "#a855f7" }, vide: {} };
    useProjectsStore.setState({
      openProjects: { projects: [filed], projectOrder: [PID] },
    } as never);
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    const icon = (name: string) =>
      screen.getByRole("button", { name }).querySelector("svg:nth-of-type(2)") as SVGElement;
    expect(icon("boutique").style.color).toBe("rgb(168, 85, 247)");
    expect(icon("armes").style.color).toBe("rgb(168, 85, 247)");
    // An empty folder has no frame on the board: no color.
    expect(icon("vide").style.color).toBe("");
  });

  it("lists the documents kind after kind", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
  });

  it("gives each document its kind's tile, with no header per kind", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} />);
    const menus = screen.getByRole("list", { name: /menus/i });
    const rows = within(menus).getAllByRole("button", { name: /^m\d$/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText(/^menus$/i)).toBeNull();
  });

  it("highlights the document open in the view", () => {
    render(<ProjectDocumentTree projectId={PID} onOpen={vi.fn()} activeId="command/c1" />);
    expect(screen.getByText("/heal").closest("button")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("m1").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("opens a document on click", () => {
    const onOpen = vi.fn();
    render(<ProjectDocumentTree projectId={PID} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("/heal"));
    expect(onOpen).toHaveBeenCalledWith("command/c1");
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

describe("ProjectDocumentTree drag", () => {
  const linked = () => {
    const p = project();
    (p.documents.command![0] as { steps: unknown[] }).steps = [
      { kind: "action", action: { name: "open_menu", value: "m1" } },
    ];
    p.folders = { boutique: {} };
    useProjectsStore.setState({ openProjects: { projects: [p], projectOrder: [PID] } } as never);
  };

  it("files a dragged document in the folder it is dropped on, and back at the root", () => {
    linked();
    const folder = () =>
      (
        useProjectsStore.getState().openProjects.projects[0]!.documents.menu![1] as {
          folder?: string;
        }
      ).folder;
    dropDocument(PID, "menu/m2", "folder:boutique");
    expect(folder()).toBe("boutique");
    dropDocument(PID, "menu/m2", null);
    expect(folder()).toBe("boutique");
    dropDocument(PID, "menu/m2", "folder:");
    expect(folder()).toBeUndefined();
  });

  it("previews the dragged document in the folder under the pointer, in the tree's order", () => {
    const groups = [
      {
        type: "menu",
        items: [
          { id: "a", label: "a", type: "menu", folder: "" },
          { id: "b", label: "b", type: "menu", folder: "boutique" },
        ],
      },
    ];
    const keyOf = (it: { type: string; id: string }) => `${it.type}/${it.id}`;
    expect(withDropPreview(groups, { key: "menu/a", target: null }, keyOf)).toBe(groups);
    const preview = withDropPreview(groups, { key: "menu/a", target: "boutique" }, keyOf);
    expect(preview[0]!.items.map((it) => [it.id, it.folder])).toEqual([
      ["a", "boutique"],
      ["b", "boutique"],
    ]);
  });
});
