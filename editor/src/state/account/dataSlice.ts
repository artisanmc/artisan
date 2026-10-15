import {
  type FieldEdit,
  type FieldEditTarget,
  applyFieldEdit,
  defaultValueForModelType,
  isDataModelReferenced,
  normalizeDataSourceName,
  releaseValueLTexts,
  sourceRootFields,
  sourceTypeAtPath,
  wouldTypeCreateModelCycle,
} from "@/domain/dataModels";
import { nextAvailableSourceRowKey, validateSourceRowKey } from "@/domain/dataSourceRowKeys";
import { rekeyDataSource, releaseLTexts, visitDataSourceLTexts } from "@/domain/i18nSites";
import { newDataModelId } from "@/domain/ids";
import type { DataModelId, DataSourceId, ProjectId } from "@/domain/types";
import { produce } from "immer";
import {
  generateDataSourceId,
  mintSourceLTexts,
  nextAvailableName,
  sourceValueContainer,
} from "./helpers";
import type { AccountSliceContext, SourceValueUpdateResult } from "./types";

/** Data sources and data models of a Project. */
export interface DataSlice {
  addProjectDataSource: (args: { projectId: ProjectId; shape?: "table" | "config" }) => void;
  removeProjectDataSource: (args: { projectId: ProjectId; id: DataSourceId }) => void;
  renameProjectDataSource: (args: {
    projectId: ProjectId;
    id: DataSourceId;
    newName: string;
  }) => boolean;
  /** One Data-model/config field edit: schema + synchronous value migration (ADR project-sources-and-data-models). */
  editSourceField: (args: {
    projectId: ProjectId;
    target: FieldEditTarget;
    edit: FieldEdit;
  }) => void;
  renameDataModel: (args: { projectId: ProjectId; modelId: DataModelId; newName: string }) => void;
  setModelKeyField: (args: {
    projectId: ProjectId;
    modelId: DataModelId;
    keyField: string;
  }) => void;
  /** Table file granularity: one source file, or one file per row (ADR composable-data-models §2). */
  setSourceGranularity: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    granularity: "row" | null;
  }) => void;
  addSourceRow: (args: { projectId: ProjectId; sourceId: DataSourceId }) => void;
  removeSourceRow: (args: { projectId: ProjectId; sourceId: DataSourceId; index: number }) => void;
  /** Set a scalar/item cell. `row: null` targets a config source's value object. */
  setSourceValue: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    value: unknown;
  }) => SourceValueUpdateResult;
  addSourceListItem: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
  }) => void;
  removeSourceListItem: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    index: number;
  }) => void;
  /**
   * Replace the whole value at a path, releasing the old value's ltext keys
   * first (typed via sourceTypeAtPath) and minting the new ones. Used by the
   * union variant switch and map entry add/remove (ADR composable-data-models).
   */
  replaceSourceValueTyped: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    value: unknown;
  }) => void;
}

export const createDataSlice = ({ set, get }: AccountSliceContext): DataSlice => ({
  addProjectDataSource: ({ projectId, shape = "table" }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        if (!project.dataSources) project.dataSources = [];
        if (!project.dataModels) project.dataModels = [];
        const id = generateDataSourceId();
        const name = nextAvailableName(project.dataSources, "new_source");
        if (shape === "config") {
          project.dataSources.push({ id, name, shape: "config", fields: [], value: {} });
          return;
        }
        // A Table is a table OF a Data model — auto-created with it (ADR
        // project-sources-and-data-models), seeded with its Row key field.
        const modelId = newDataModelId();
        project.dataModels.push({
          id: modelId,
          name,
          keyField: "id",
          fields: [{ name: "id", type: { kind: "string" } }],
        });
        project.dataSources.push({ id, name, shape: "table", modelId, rows: [] });
      }),
    ),
  removeProjectDataSource: ({ projectId, id }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === id);
        if (!ds) return;
        releaseLTexts(project, visitDataSourceLTexts(project, ds));
        project.dataSources = project.dataSources.filter((d) => d.id !== id);
        // GC the auto-created model when nothing else references it.
        if (ds.shape === "table" && !isDataModelReferenced(project, ds.modelId)) {
          project.dataModels = (project.dataModels ?? []).filter((m) => m.id !== ds.modelId);
        }
      }),
    ),
  renameProjectDataSource: ({ projectId, id, newName }) => {
    const normalizedName = normalizeDataSourceName(newName);
    const project = get().account.projects.find((p) => p.id === projectId);
    if (
      !project ||
      normalizedName === "" ||
      project.dataSources.some(
        (source) => source.id !== id && normalizeDataSourceName(source.name) === normalizedName,
      )
    ) {
      return false;
    }

    let renamed = false;
    set((state) =>
      produce(state, (draft) => {
        const draftProject = draft.account.projects.find((p) => p.id === projectId);
        const dataSource = draftProject?.dataSources.find((source) => source.id === id);
        if (!draftProject || !dataSource) return;
        dataSource.name = normalizedName;
        rekeyDataSource(draftProject, dataSource);
        renamed = true;
      }),
    );
    return renamed;
  },
  editSourceField: ({ projectId, target, edit }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        if (target.kind === "model" && (edit.op === "add" || edit.op === "retype")) {
          const t = edit.op === "add" ? edit.field.type : edit.newType;
          if (wouldTypeCreateModelCycle(project.dataModels ?? [], target.modelId, t)) return;
        }
        applyFieldEdit(project, target, edit);
        mintSourceLTexts(project);
      }),
    ),
  renameDataModel: ({ projectId, modelId, newName }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        const m = project?.dataModels?.find((x) => x.id === modelId);
        if (m) m.name = newName;
      }),
    ),
  setModelKeyField: ({ projectId, modelId, keyField }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        const m = project?.dataModels?.find((x) => x.id === modelId);
        // Placements pinned on the old key dangle — never rewritten (ADR).
        if (m && project) {
          m.keyField = keyField;
          mintSourceLTexts(project);
        }
      }),
    ),
  addSourceRow: ({ projectId, sourceId }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (ds?.shape !== "table") return;
        const model = project.dataModels?.find((dataModel) => dataModel.id === ds.modelId);
        if (!model) return;
        const row = defaultValueForModelType(
          { kind: "object", fields: sourceRootFields(project, ds) },
          project.dataModels ?? [],
        ) as Record<string, unknown>;
        row[model.keyField] = nextAvailableSourceRowKey(project, ds);
        ds.rows.push(row);
        mintSourceLTexts(project);
      }),
    ),
  removeSourceRow: ({ projectId, sourceId, index }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (ds?.shape !== "table") return;
        const row = ds.rows[index];
        if (row === undefined) return;
        releaseValueLTexts(project, row, {
          kind: "object",
          fields: sourceRootFields(project, ds),
        });
        ds.rows.splice(index, 1);
        rekeyDataSource(project, ds);
      }),
    ),
  setSourceGranularity: ({ projectId, sourceId, granularity }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        const ds = project?.dataSources.find((d) => d.id === sourceId);
        if (!ds || ds.shape !== "table") return;
        if (granularity === "row") ds.granularity = "row";
        else Reflect.deleteProperty(ds, "granularity");
      }),
    ),
  setSourceValue: ({ projectId, sourceId, row, path, value }) => {
    let nextValue = value;
    if (row !== null && path.length === 1) {
      const project = get().account.projects.find((p) => p.id === projectId);
      const ds = project?.dataSources.find((d) => d.id === sourceId);
      const model =
        ds?.shape === "table"
          ? project?.dataModels?.find((dataModel) => dataModel.id === ds.modelId)
          : undefined;
      const container = ds ? sourceValueContainer(ds, row, []) : undefined;
      if (ds?.shape === "table" && model && path[0] === model.keyField && container !== undefined) {
        const validation = validateSourceRowKey(project!, ds, row, value);
        if (!validation.ok) {
          return {
            ok: false,
            reason: validation.reason === "required" ? "required_row_key" : "duplicate_row_key",
          };
        }
        nextValue = validation.value;
      }
    }
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (!ds) return;
        const container = sourceValueContainer(ds, row, path.slice(0, -1));
        const last = path[path.length - 1];
        if (container === undefined || last === undefined) return;
        (container as Record<string | number, unknown>)[last] = nextValue;
        rekeyDataSource(project, ds);
      }),
    );
    return { ok: true };
  },
  addSourceListItem: ({ projectId, sourceId, row, path }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (!ds) return;
        const listType = sourceTypeAtPath(project, ds, path);
        if (listType?.kind !== "list") return;
        const list = sourceValueContainer(ds, row, path);
        if (!Array.isArray(list)) return;
        list.push(defaultValueForModelType(listType.of, project.dataModels ?? []));
        mintSourceLTexts(project);
      }),
    ),
  removeSourceListItem: ({ projectId, sourceId, row, path, index }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (!ds) return;
        const listType = sourceTypeAtPath(project, ds, path);
        const list = sourceValueContainer(ds, row, path);
        if (!Array.isArray(list) || list[index] === undefined) return;
        if (listType?.kind === "list") releaseValueLTexts(project, list[index], listType.of);
        list.splice(index, 1);
        rekeyDataSource(project, ds);
      }),
    ),
  replaceSourceValueTyped: ({ projectId, sourceId, row, path, value }) =>
    set((state) =>
      produce(state, (draft) => {
        const project = draft.account.projects.find((p) => p.id === projectId);
        if (!project) return;
        const ds = project.dataSources.find((d) => d.id === sourceId);
        if (!ds) return;
        const type = sourceTypeAtPath(project, ds, path);
        const container = sourceValueContainer(ds, row, path.slice(0, -1));
        const last = path[path.length - 1];
        if (container === undefined || last === undefined) return;
        const old = (container as Record<string | number, unknown>)[last];
        if (type) releaseValueLTexts(project, old, type);
        (container as Record<string | number, unknown>)[last] = value;
        mintSourceLTexts(project);
        rekeyDataSource(project, ds);
      }),
    ),
});
