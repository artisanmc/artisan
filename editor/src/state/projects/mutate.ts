import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { appearanceAt } from "@/domain/element";
import type {
  Appearance,
  ClickHandler,
  ClickType,
  Command,
  CommandId,
  Dialog,
  DialogId,
  Element,
  ElementId,
  Menu,
  MenuId,
  Project,
  ProjectId,
} from "@/domain/types";
import { versionEditedDocuments } from "@/domain/variants";
import { produce } from "immer";
import type { StoreApi } from "zustand";
import type { AppearanceTarget, ProjectsState } from "./types";

/**
 * The body of a project-internal action. It edits the live immer draft it is handed.
 * Returning `false` leaves `updatedAt` alone: the early exit of a no-op (whatever it
 * already wrote is still committed, as with a bare `return` in a recipe).
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a body that falls off its end returns `void`.
export type Mutation<Args extends unknown[]> = (...args: Args) => void | false;

export interface MutateOptions {
  /** `false`: the edit is not Project content (board layout, sources), never stamp `updatedAt`. */
  touch?: boolean;
}

/**
 * The lookup + mutate + stamp sequence every slice action shares, in one place. Each
 * helper runs one `produce` over the store, finds its target in the Project, does
 * nothing at all when the target is missing, runs the body, then stamps the Project's
 * `updatedAt` unless the body returned `false`. Undo needs nothing more: the temporal
 * middleware records a step whenever `openProjects` changed.
 */
export interface ProjectMutators {
  mutateProject: (
    projectId: ProjectId,
    fn: Mutation<[project: Project, draft: ProjectsState]>,
    options?: MutateOptions,
  ) => void;
  mutateMenu: (
    projectId: ProjectId,
    menuId: MenuId,
    fn: Mutation<[menu: Menu, project: Project]>,
    options?: MutateOptions,
  ) => void;
  /** The element with that id in any layer of the menu. */
  mutateElement: (
    projectId: ProjectId,
    menuId: MenuId,
    elementId: ElementId,
    fn: Mutation<[element: Element, menu: Menu, project: Project]>,
  ) => void;
  /** The element's appearance at `index`: 0 is its display, N is `states[N - 1]`. */
  mutateAppearance: (
    projectId: ProjectId,
    target: AppearanceTarget,
    index: number,
    fn: Mutation<[appearance: Appearance, project: Project]>,
  ) => void;
  /** An existing click handler of an appearance. */
  mutateClickHandler: (
    projectId: ProjectId,
    target: AppearanceTarget,
    index: number,
    clickType: ClickType,
    fn: Mutation<[handler: ClickHandler, project: Project]>,
  ) => void;
  mutateCommand: (
    projectId: ProjectId,
    commandId: CommandId,
    fn: Mutation<[command: Command, project: Project]>,
  ) => void;
  mutateDialog: (
    projectId: ProjectId,
    dialogId: DialogId,
    fn: Mutation<[dialog: Dialog, project: Project]>,
  ) => void;
}

export function findElement(menu: Menu, elementId: ElementId): Element | undefined {
  for (const layer of menu.layers) {
    const el = layer.elements.find((e) => e.id === elementId);
    if (el) return el;
  }
  return undefined;
}

export function createProjectMutators(set: StoreApi<ProjectsState>["setState"]): ProjectMutators {
  const mutateProject: ProjectMutators["mutateProject"] = (projectId, fn, options) =>
    set(
      produce((draft: ProjectsState) => {
        const project = draft.openProjects.projects.find((p) => p.id === projectId);
        if (!project) return;
        // The recipe itself returns nothing: a returned value would replace the state.
        if (fn(project, draft) === false || options?.touch === false) return;
        // While a variant is shown, an edit of the module's Document makes it the variant's.
        versionEditedDocuments(project);
        project.updatedAt = new Date().toISOString();
      }),
    );

  const mutateMenu: ProjectMutators["mutateMenu"] = (projectId, menuId, fn, options) =>
    mutateProject(
      projectId,
      (project) => {
        const menu = menusOf(project).find((m) => m.id === menuId);
        return menu ? fn(menu, project) : false;
      },
      options,
    );

  return {
    mutateProject,
    mutateMenu,
    mutateElement: (projectId, menuId, elementId, fn) =>
      mutateMenu(projectId, menuId, (menu, project) => {
        const element = findElement(menu, elementId);
        return element ? fn(element, menu, project) : false;
      }),
    mutateAppearance: (projectId, target, index, fn) =>
      mutateMenu(projectId, target.menuId, (menu, project) => {
        const element = findElement(menu, target.elementId);
        const appearance = element ? appearanceAt(element, index) : undefined;
        return appearance ? fn(appearance, project) : false;
      }),
    mutateClickHandler: (projectId, target, index, clickType, fn) =>
      mutateMenu(projectId, target.menuId, (menu, project) => {
        const element = findElement(menu, target.elementId);
        const handler = element ? appearanceAt(element, index)?.click?.[clickType] : undefined;
        return handler ? fn(handler, project) : false;
      }),
    mutateCommand: (projectId, commandId, fn) =>
      mutateProject(projectId, (project) => {
        const command = commandsOf(project).find((c) => c.id === commandId);
        return command ? fn(command, project) : false;
      }),
    mutateDialog: (projectId, dialogId, fn) =>
      mutateProject(projectId, (project) => {
        const dialog = dialogsOf(project).find((d) => d.id === dialogId);
        return dialog ? fn(dialog, project) : false;
      }),
  };
}
