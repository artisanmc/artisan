import { liveDocumentIds, normalizeCanvasGroups } from "@/domain/canvasGroups";
import { allDocuments, emptyDocuments, menusOf, mutableMenus } from "@/domain/documents";
import { newProjectId } from "@/domain/ids";
import { migrateTitle } from "@/domain/migrateTitle";
import type { Account, MenuId, Project, ProjectId } from "@/domain/types";
import { migrateProjectToI18n } from "@/lib/i18nMigration";
import { migrateProjectDocuments } from "@/lib/projectDocumentsMigration";
import { produce } from "immer";
import { gcDocumentLTexts, mintSourceLTexts } from "./helpers";
import type { AccountSliceContext, AccountState } from "./types";

/** The account and its Projects: creation, import, replacement, ordering, deletion of Documents. */
export interface ProjectsSlice {
  setAccount: (account: Account) => void;
  createProject: (input: { id: string }) => ProjectId;
  /**
   * Import a project object as a *new* project: assigns a fresh ProjectId, marks
   * source=imported, retags every contained menu/command with the new
   * projectId. Throws on malformed input.
   */
  importProject: (input: { project: Project }) => ProjectId;
  replaceProject: (project: Project) => void;
  /**
   * Write a module's namespace in Project.moduleData, replacing its prior
   * value wholesale. Other modules' namespaces are preserved.
   */
  setModuleData: (projectId: ProjectId, moduleId: string, data: unknown) => void;
  removeProject: (projectId: ProjectId) => void;
  /** Insert/replace a Config-screen scratch working copy (never persisted — ADR module-config-screens). */
  upsertScratchProject: (project: Project) => void;
  reorderProjects: (newOrder: ProjectId[]) => void;
  moveMenuToProject: (input: {
    menuId: MenuId;
    fromProjectId: ProjectId;
    toProjectId: ProjectId;
  }) => void;
  deleteFromProject: (input: { projectId: ProjectId; nodeIds: string[] }) => void;
  setProjectField: (input: {
    projectId: ProjectId;
    field: "name" | "description" | "loreMaxWidth" | "escapeGoesBack";
    value: string | boolean;
  }) => void;
}

export const createProjectsSlice = ({
  set,
  get,
  clearTemporal,
  mutateProject,
}: AccountSliceContext): ProjectsSlice => ({
  setAccount: (account) => {
    clearTemporal();
    const migratedProjects = account.projects.map((p) => {
      const next = { ...p };
      // A stored account may predate `Project.documents` (ADR decision 10).
      migrateProjectDocuments(next);
      return {
        ...next,
        documents: {
          ...next.documents,
          menu: menusOf(next).map((m) => ({ ...m, title: migrateTitle(m.title) })),
        },
      };
    });
    const migratedAccount = produce({ ...account, projects: migratedProjects }, (draft) => {
      for (const project of draft.projects) mintSourceLTexts(project);
    });
    set({ account: migratedAccount });
  },
  createProject: ({ id: rawId }) => {
    const id = rawId as ProjectId;
    set(
      produce((draft: AccountState) => {
        draft.account.projects.push({
          id,
          name: rawId,
          source: "user_created",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          documents: emptyDocuments(),
          assets: [],
          dataSources: [],
          i18nKeys: {},
          defaultLang: "en",
          loreMaxWidth: 240,
          canvasLayout: {},
        });
        draft.account.projectOrder.push(id);
      }),
    );
    clearTemporal();
    return id;
  },
  importProject: ({ project: incoming }) => {
    // Light shape check — the input came from a user-supplied file so
    // we don't fully trust it, but we don't deep-validate either.
    if (!incoming || typeof incoming !== "object") {
      throw new Error("invalid project: not an object");
    }
    if (typeof incoming.name !== "string") throw new Error("invalid project: missing name");
    // A file written before `Project.documents` carries `menus` / `commands` /
    // `dialogs` at the top level: fold them into the container first.
    const folded = { ...incoming };
    migrateProjectDocuments(folded);
    if (!folded.documents || typeof folded.documents !== "object")
      throw new Error("invalid project: missing documents");
    for (const [kind, docs] of Object.entries(folded.documents)) {
      if (!Array.isArray(docs)) throw new Error(`invalid project: documents.${kind} is not a list`);
    }

    const id = newProjectId();
    set(
      produce((draft: AccountState) => {
        const next: Project = {
          ...folded,
          id,
          // Force fresh source/timestamps even if the file claimed otherwise.
          source: "imported" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Retag children so their projectId matches the new project id.
          documents: Object.fromEntries(
            Object.entries(folded.documents).map(([kind, docs]) => [
              kind,
              docs.map((d) => ({ ...d, projectId: id })),
            ]),
          ),
          assets: (folded.assets ?? []).map((a) => ({ ...a, projectId: id })),
          i18nKeys: folded.i18nKeys ?? {},
          defaultLang: folded.defaultLang ?? "en",
          canvasLayout: folded.canvasLayout ?? {},
        };
        // Imported project may use the legacy plain-string shape — migrate
        // in place so it lines up with the current LText-based domain.
        migrateProjectToI18n(next, next.defaultLang);
        // Migrate menu titles from LText to MenuTitleLayer[].
        for (const menu of mutableMenus(next)) {
          menu.title = migrateTitle(menu.title);
        }
        draft.account.projects.push(next);
        draft.account.projectOrder.push(id);
      }),
    );
    clearTemporal();
    return id;
  },
  replaceProject: (project) => {
    clearTemporal();
    set(
      produce((draft: AccountState) => {
        const idx = draft.account.projects.findIndex((p) => p.id === project.id);
        if (idx !== -1) {
          draft.account.projects[idx] = {
            ...project,
            documents: {
              ...project.documents,
              menu: menusOf(project).map((m) => ({ ...m, title: migrateTitle(m.title) })),
            },
          };
        }
      }),
    );
  },
  setModuleData: (projectId, moduleId, data) => {
    mutateProject(projectId, (project) => {
      project.moduleData = { ...(project.moduleData ?? {}), [moduleId]: data };
    });
  },
  removeProject: (projectId) => {
    set(
      produce((draft: AccountState) => {
        draft.account.projects = draft.account.projects.filter((p) => p.id !== projectId);
        draft.account.projectOrder = draft.account.projectOrder.filter((id) => id !== projectId);
      }),
    );
    clearTemporal();
  },
  upsertScratchProject: (project) => {
    set(
      produce((draft: AccountState) => {
        const idx = draft.account.projects.findIndex((p) => p.id === project.id);
        if (idx === -1) draft.account.projects.push(project);
        else draft.account.projects[idx] = project;
      }),
    );
    clearTemporal();
  },
  reorderProjects: (newOrder) => {
    set(
      produce((draft: AccountState) => {
        draft.account.projectOrder = [...newOrder];
      }),
    );
    clearTemporal();
  },
  moveMenuToProject: ({ menuId: mId, fromProjectId, toProjectId }) => {
    const next = produce(get().account, (draft) => {
      const from = draft.projects.find((p) => p.id === fromProjectId);
      const to = draft.projects.find((p) => p.id === toProjectId);
      if (!from || !to) throw new Error("project not found");
      const idx = menusOf(from).findIndex((m) => m.id === mId);
      if (idx === -1) throw new Error("menu not found in source project");
      const [moved] = mutableMenus(from).splice(idx, 1);
      if (!moved) return;
      from.canvasGroups = normalizeCanvasGroups(from.canvasGroups, liveDocumentIds(from));
      moved.projectId = toProjectId;
      mutableMenus(to).push(moved);
    });
    set({ account: next });
  },
  setProjectField: ({ projectId: pId, field, value }) =>
    mutateProject(pId, (project) => {
      if (field === "escapeGoesBack") project.escapeGoesBack = value === true || undefined;
      else if (typeof value !== "string") return false;
      else if (field === "name") project.name = value;
      else if (field === "description") project.description = value || undefined;
      else if (field === "loreMaxWidth") {
        project.loreMaxWidth = Math.max(0, Math.floor(Number(value)) || 0) || undefined;
      }
    }),
  deleteFromProject: ({ projectId: pId, nodeIds }) => {
    const ids = new Set(nodeIds);
    mutateProject(
      pId,
      (project) => {
        for (const { kind, doc } of allDocuments(project)) {
          if (ids.has(doc.id)) gcDocumentLTexts(project, kind, doc);
        }
        for (const kind of Object.keys(project.documents)) {
          project.documents[kind] = (project.documents[kind] ?? []).filter((d) => !ids.has(d.id));
        }
        if (project.canvasGroups) {
          project.canvasGroups = normalizeCanvasGroups(
            project.canvasGroups,
            liveDocumentIds(project),
          );
        }
        for (const id of ids) {
          delete (project.canvasLayout as Record<string, { x: number; y: number }>)[id];
        }
        if (project.canvasEdges) {
          for (const key of Object.keys(project.canvasEdges)) {
            const [src, tgt] = key.split("->") as [string, string];
            if (ids.has(src) || ids.has(tgt)) delete project.canvasEdges[key];
          }
        }
      },
      // A deletion has never stamped `updatedAt`; kept as is.
      { touch: false },
    );
  },
});
