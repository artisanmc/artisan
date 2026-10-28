import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { commandId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { Dialog, OpenProjects, Project } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { createProjectMutators } from "./mutate";
import type { ProjectsState } from "./types";

const P = projectId("p_personal");
const MENU = menuId("m_shop_main");
const BTN = elementId("el_btn_profile");
const DEEP = elementId("el_deep");
const CMD = commandId("c_heal");
const DIALOG = dialogId("d_confirm");
const OLD_STAMP = "2000-01-01T00:00:00.000Z";

/** The mock open Projects, plus an element on a second layer, a state and a dialog. */
function fixture(): OpenProjects {
  const openProjects = mockOpenProjects();
  const project = openProjects.projects.find((p) => p.id === P)!;
  project.updatedAt = OLD_STAMP;
  const menu = menusOf(project).find((m) => m.id === MENU)!;
  menu.layers[0]!.elements[0]!.states.push({ material: "STONE" });
  menu.layers.push({
    id: layerId("l_second"),
    name: "second",
    elements: [{ id: DEEP, positions: "1", display: { material: "DIRT" }, states: [] }],
  });
  project.documents.dialog = [{ id: DIALOG, projectId: P, buttons: [] } as unknown as Dialog];
  return openProjects;
}

function setup() {
  const store = createStore<ProjectsState>()(() => ({ openProjects: fixture() }) as ProjectsState);
  const project = (): Project => store.getState().openProjects.projects.find((p) => p.id === P)!;
  return { store, project, ...createProjectMutators(store.setState) };
}

describe("project mutators", () => {
  it("mutateProject runs the body on the draft and stamps updatedAt", () => {
    const { mutateProject, project } = setup();
    mutateProject(P, (p) => {
      p.name = "renamed";
    });
    expect(project().name).toBe("renamed");
    expect(project().updatedAt).not.toBe(OLD_STAMP);
  });

  it("a body returning false keeps its writes but leaves updatedAt alone", () => {
    const { mutateProject, project } = setup();
    mutateProject(P, (p) => {
      p.name = "renamed";
      return false;
    });
    expect(project().name).toBe("renamed");
    expect(project().updatedAt).toBe(OLD_STAMP);
  });

  it("touch: false never stamps updatedAt", () => {
    const { mutateProject, project } = setup();
    mutateProject(
      P,
      (p) => {
        p.canvasLayout = {};
      },
      { touch: false },
    );
    expect(project().canvasLayout).toEqual({});
    expect(project().updatedAt).toBe(OLD_STAMP);
  });

  it("a missing target is a no-op that keeps the state reference and never runs the body", () => {
    const m = setup();
    const before = m.store.getState();
    let ran = false;
    const body = () => {
      ran = true;
    };
    m.mutateProject(projectId("p_missing"), body);
    m.mutateMenu(P, menuId("m_missing"), body);
    m.mutateElement(P, MENU, elementId("el_missing"), body);
    m.mutateAppearance(P, { menuId: MENU, elementId: BTN }, 5, body);
    m.mutateClickHandler(P, { menuId: MENU, elementId: BTN }, 0, "right", body);
    m.mutateCommand(P, commandId("c_missing"), body);
    m.mutateDialog(P, dialogId("d_missing"), body);
    expect(ran).toBe(false);
    expect(m.store.getState()).toBe(before);
  });

  it("a throwing body leaves the state untouched", () => {
    const { mutateMenu, store } = setup();
    const before = store.getState();
    expect(() =>
      mutateMenu(P, MENU, (menu) => {
        menu.rows = 6;
        throw new Error("refused");
      }),
    ).toThrow("refused");
    expect(store.getState()).toBe(before);
  });

  it("mutateMenu and mutateElement hand over the live menu, element and project", () => {
    const { mutateMenu, mutateElement, project } = setup();
    mutateMenu(P, MENU, (menu, p) => {
      menu.rows = 6;
      expect(p.id).toBe(P);
    });
    // The element sits on the second layer: the lookup walks every layer.
    mutateElement(P, MENU, DEEP, (el, menu) => {
      el.positions = "2";
      expect(menu.id).toBe(MENU);
    });
    const menu = menusOf(project()).find((m) => m.id === MENU)!;
    expect(menu.rows).toBe(6);
    expect(menu.layers[1]!.elements[0]!.positions).toBe("2");
  });

  it("mutateAppearance addresses the display at 0 and states from 1", () => {
    const { mutateAppearance, project } = setup();
    const target = { menuId: MENU, elementId: BTN };
    mutateAppearance(P, target, 0, (a) => {
      a.count = 2;
    });
    mutateAppearance(P, target, 1, (a) => {
      a.count = 3;
    });
    const el = menusOf(project()).find((m) => m.id === MENU)!.layers[0]!.elements[0]!;
    expect(el.display.count).toBe(2);
    expect(el.states[0]!.count).toBe(3);
  });

  it("mutateClickHandler reaches an existing handler", () => {
    const { mutateClickHandler, project } = setup();
    mutateClickHandler(P, { menuId: MENU, elementId: BTN }, 0, "left", (handler) => {
      handler.steps = [];
    });
    const el = menusOf(project()).find((m) => m.id === MENU)!.layers[0]!.elements[0]!;
    expect(el.display.click?.left?.steps).toEqual([]);
  });

  it("mutateCommand and mutateDialog find their Document", () => {
    const { mutateCommand, mutateDialog, project } = setup();
    mutateCommand(P, CMD, (cmd) => {
      cmd.name = "cure";
    });
    mutateDialog(P, DIALOG, (dialog) => {
      dialog.canCloseWithEscape = false;
    });
    expect(commandsOf(project())[0]!.name).toBe("cure");
    expect(dialogsOf(project())[0]!.canCloseWithEscape).toBe(false);
  });
});

describe("project mutators in the projects store", () => {
  beforeEach(() => {
    useProjectsStore.setState({ openProjects: fixture() });
    useProjectsStore.temporal.getState().clear();
  });

  it("records one undo step per edit and none for a no-op", () => {
    const { setCommandField } = useProjectsStore.getState();
    setCommandField({ projectId: P, commandId: commandId("c_missing"), field: "name", value: "x" });
    expect(useProjectsStore.temporal.getState().pastStates).toHaveLength(0);
    setCommandField({ projectId: P, commandId: CMD, field: "name", value: "cure" });
    expect(useProjectsStore.temporal.getState().pastStates).toHaveLength(1);
    useProjectsStore.temporal.getState().undo();
    const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === P)!;
    expect(commandsOf(project)[0]!.name).toBe("heal");
  });
});
