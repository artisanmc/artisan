/**
 * Ids are unique across the whole project: every "new Document" dialog refuses (or
 * steps around) an id a Document of any kind already holds, module kinds included.
 */
import "@/i18n";
import type { OpenProjects, Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { beforeEach, describe, expect, it } from "vitest";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { NewDocumentDialog } from "./NewDocumentDialog";
import { NewMenuDialog } from "./NewMenuDialog";
import { uniqueDocumentId } from "./newDocumentId";

const PID = "p1" as ProjectId;

function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [],
      command: [],
      dialog: [],
      // A module's kind holding ids a core dialog would otherwise produce.
      quest: [{ id: "menu_shop" }, { id: "dialog_shop" }, { id: "cmd_shop" }] as never[],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

const docCount = () =>
  Object.values(useProjectsStore.getState().openProjects.projects[0]!.documents).flat().length;

describe("new Document dialogs", () => {
  beforeEach(() => {
    const openProjects: OpenProjects = {
      projects: [project()],
      projectOrder: [PID],
    };
    useProjectsStore.setState({ openProjects });
    useSelectionStore.getState().clear();
  });

  it.each([
    ["menu", NewMenuDialog],
    ["dialog", NewDialogDialog],
  ])("the %s dialog refuses an id a module Document holds", (_, Component) => {
    render(<Component projectId={PID} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "shop" } });
    expect(screen.getByText(i18n.t("canvas.idConflict"))).toBeTruthy();
    const create = screen.getByRole("button", {
      name: i18n.t("canvas.create"),
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(docCount()).toBe(3);
  });

  it("the module kind dialog refuses an id a core Document holds", () => {
    const p = project();
    p.documents.menu = [{ id: "x" }] as never[];
    useProjectsStore.setState({
      openProjects: { projects: [p], projectOrder: [PID] },
    });
    // Unknown kind: no prefix, so the typed id is the full id.
    render(<NewDocumentDialog projectId={PID} kind="quest" open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(screen.getByText(i18n.t("canvas.idConflict"))).toBeTruthy();
  });

  it("the menu dialog creates a free id", () => {
    render(<NewMenuDialog projectId={PID} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "home" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(
      useProjectsStore.getState().openProjects.projects[0]!.documents.menu!.map((m) => m.id),
    ).toEqual(["menu_home"]);
  });

  it("the command dialog steps around an id a module Document holds", () => {
    render(<NewCommandDialog projectId={PID} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Shop" } });
    expect(screen.getByText("cmd_shop_1")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(
      useProjectsStore.getState().openProjects.projects[0]!.documents.command!.map((c) => c.id),
    ).toEqual(["cmd_shop_1"]);
  });
});

describe("uniqueDocumentId", () => {
  it("returns the base when free, else the first free suffix, across kinds", () => {
    const p = project();
    expect(uniqueDocumentId(p, "cmd_free")).toBe("cmd_free");
    expect(uniqueDocumentId(p, "cmd_shop")).toBe("cmd_shop_1");
    p.documents.dialog = [{ id: "cmd_shop_1" }] as never[];
    expect(uniqueDocumentId(p, "cmd_shop")).toBe("cmd_shop_2");
    expect(uniqueDocumentId(undefined, "cmd_shop")).toBe("cmd_shop");
  });
});
