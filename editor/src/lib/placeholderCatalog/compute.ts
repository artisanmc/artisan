import type { FieldType, Menu, Project } from "@/domain/types";
import { sourceFieldType } from "@/domain/dataModels";
import {
  buildPreviewScope,
  SAMPLE_PLAYER_NAME,
  SAMPLE_PLAYER_UUID,
  SAMPLE_PLAYER_WORLD,
} from "@/features/canvas/menuPreviewScope";
import { renderSample, walkPath } from "./sample";
import type {
  FieldLocation,
  PlaceholderEntry,
  PlaceholderOrigin,
  PlaceholderType,
} from "./types";

const ORDER: Record<PlaceholderOrigin, number> = {
  context: 0,
  iteration: 1,
  pagination: 2,
  source: 3,
};

/**
 * Walk the pack and the requested location to produce a flat list of
 * placeholder entries the user can insert in this field. Pure — no
 * side effects, safe to call from useMemo.
 */
/** Field schemas of server-reported sources, keyed by ref — lets `rowOf`-typed
 *  context inputs expose their fields without compute() touching any store. */
export type RowModelSchemas = Record<string, { name: string; type: string }[]>;

export function compute(
  pack: Project,
  location: FieldLocation,
  rowSchemas?: RowModelSchemas,
): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = pack.menus.find((m) => m.id === location.menuId);
      if (!menu) return [];
      // Build the preview scope once; thread it through all helpers.
      const scope = buildPreviewScope(menu, pack);
      const out: PlaceholderEntry[] = [];
      // Builtin implicit {player} = the viewing player, unless the menu
      // declares a contextInput named `player` (caller arg wins, like the
      // plugin runtime — the declared input's own entries show instead).
      if (!(menu.contextInputs ?? []).some((i) => i.name === "player")) {
        out.push(...builtinPlayerEntries());
      }
      collectMenuContextInputs(menu, pack, scope, out, rowSchemas);
      if (location.kind === "element" || location.kind === "action") {
        const element = findElement(menu, location.elementId);
        if (element?.iterates) {
          collectIterationLeaves(element.iterates.source, element.iterates.alias, pack, menu, scope, out);
          collectPagination(out);
        }
      }
      out.sort((a, b) => {
        if (ORDER[a.origin] !== ORDER[b.origin]) return ORDER[a.origin] - ORDER[b.origin];
        return a.path.localeCompare(b.path);
      });
      return out;
    }
    case "dialog":
    case "dialog-action":
      // Dialogs have no contextInputs yet — the builtin {player} is still in
      // scope at runtime, so the popup is never empty.
      return builtinPlayerEntries();
  }
}

/** The implicit `{player}` entries available everywhere at runtime. */
function builtinPlayerEntries(): PlaceholderEntry[] {
  return [
    { path: "player", type: "player", sample: SAMPLE_PLAYER_NAME, origin: "context" },
    ...playerSubfieldEntries("player", SAMPLE_PLAYER_NAME),
  ];
}

/** `.name` / `.uuid` / `.world` rows for a Player-valued placeholder. */
function playerSubfieldEntries(base: string, nameSample: string | null): PlaceholderEntry[] {
  return [
    { path: `${base}.name`, type: "string", sample: nameSample, origin: "context" },
    { path: `${base}.uuid`, type: "string", sample: SAMPLE_PLAYER_UUID, origin: "context" },
    { path: `${base}.world`, type: "string", sample: SAMPLE_PLAYER_WORLD, origin: "context" },
  ];
}

function collectMenuContextInputs(
  menu: Menu,
  pack: Project,
  scope: ReturnType<typeof buildPreviewScope>,
  out: PlaceholderEntry[],
  rowSchemas?: RowModelSchemas,
): void {
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      const type = primitiveContextInputTypeToPlaceholderType(input.type);
      out.push({
        path: input.name,
        type,
        sample: sampleFromScope(scope, input.name),
        origin: "context",
      });
      if (type === "player") {
        // Player-valued args expose name/uuid/world at runtime.
        out.push(...playerSubfieldEntries(input.name, sampleFromScope(scope, `${input.name}.name`)));
      }
      // Row-model input (`rowOf`): expose the source's fields as subpaths —
      // {cat.name}, {cat.id}… typed from the declared schema.
      if (input.type === "object" && input.rowOf) {
        for (const f of rowSchemaFields(String(input.rowOf), pack, rowSchemas)) {
          const path = `${input.name}.${f.name}`;
          out.push({
            path,
            type: fieldKindToPlaceholderType(f.type),
            sample: sampleFromScope(scope, path),
            origin: "context",
          });
        }
      }
      continue;
    }
    // sourceRef
    const resolvedType = typeOfSourceRef(input.ref, pack);
    if (!resolvedType) {
      // Server refs (`namespace:source`) legitimately have no design-time
      // FieldType — their schema lives in the server report, and iteration
      // aliases expose the leaves. Only a dangling `pack:` ref is a problem.
      if (input.ref.startsWith("pack:")) {
        console.warn(
          `[placeholderCatalog] menu "${menu.id}" contextInput "${input.name}" → sourceRef "${input.ref}" points at a deleted dataSource. Omitted.`,
        );
      }
      continue;
    }
    if (resolvedType.kind === "list") {
      // Not directly usable at menu scope. Iteration alias will expose the
      // leaves later when an element wraps it in `iterates`.
      continue;
    }
    if (resolvedType.kind === "object") {
      for (const field of resolvedType.fields) {
        const path = `${input.name}.${field.name}`;
        out.push({
          path,
          type: fieldTypeToPlaceholderType(field.type),
          sample: sampleFromScope(scope, path),
          origin: "context",
        });
      }
      continue;
    }
    // primitive leaf (string / integer / number / boolean)
    out.push({
      path: input.name,
      type: fieldTypeToPlaceholderType(resolvedType),
      sample: sampleFromScope(scope, input.name),
      origin: "context",
    });
  }
}

/** Resolve a dot-separated path against a pre-built scope and render it. */
function sampleFromScope(scope: ReturnType<typeof buildPreviewScope>, path: string): string | null {
  return renderSample(walkPath(scope, path));
}

/** Map a primitive contextInput's `type` string to a PlaceholderType, defaulting to "string". */
function primitiveContextInputTypeToPlaceholderType(t: string): PlaceholderType {
  switch (t) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
    case "player":
    case "list":
    case "object":
      return t as PlaceholderType;
    default:
      return "string";
  }
}

/** Declared field schema of a source ref: server report first, then pack data. */
function rowSchemaFields(
  ref: string,
  pack: Project,
  rowSchemas?: RowModelSchemas,
): { name: string; type: string }[] {
  const server = rowSchemas?.[ref];
  if (server && server.length > 0) return server;
  if (ref.startsWith("pack:")) {
    const t = typeOfSourceRef(ref, pack);
    const row = t?.kind === "list" ? t.of : t;
    if (row?.kind === "object") {
      return row.fields.map((f) => ({ name: f.name, type: f.type.kind }));
    }
  }
  return [];
}

function fieldKindToPlaceholderType(kind: string): PlaceholderType {
  switch (kind) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
    case "list":
    case "object":
      return kind as PlaceholderType;
    default:
      return "string";
  }
}

function typeOfSourceRef(ref: string, pack: Project): FieldType | null {
  if (ref.startsWith("pack:")) {
    const id = ref.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === id);
    return ds ? sourceFieldType(pack, ds) : null;
  }
  // Server refs: no design-time FieldType — the schema comes from the server
  // report (serverDataSourcesStore), not the project. Unknown here.
  return null;
}

function fieldTypeToPlaceholderType(t: FieldType): PlaceholderType {
  switch (t.kind) {
    case "string": return "string";
    case "integer": return "integer";
    case "number": return "number";
    case "boolean": return "boolean";
    case "list": return "list";
    case "object": return "object";
  }
}

function findElement(menu: Menu, elementId: string) {
  for (const layer of menu.layers) {
    for (const el of layer.elements) if (el.id === elementId) return el;
  }
  return undefined;
}

function collectIterationLeaves(
  sourcePath: string,
  alias: string,
  pack: Project,
  menu: Menu,
  scope: ReturnType<typeof buildPreviewScope>,
  out: PlaceholderEntry[],
): void {
  const sourceInput = (menu.contextInputs ?? []).find(
    (i) => i.kind === "sourceRef" && i.name === sourcePath,
  );
  if (!sourceInput || sourceInput.kind !== "sourceRef") return;
  const type = typeOfSourceRef(sourceInput.ref, pack);
  if (!type || type.kind !== "list") return;
  const itemType = type.of;
  if (itemType.kind === "object") {
    for (const field of itemType.fields) {
      const leafPath = `${alias}.${field.name}`;
      out.push({
        path: leafPath,
        type: fieldTypeToPlaceholderType(field.type),
        sample: iterationSample(scope, sourcePath, alias, leafPath),
        origin: "iteration",
      });
    }
  } else {
    out.push({
      path: alias,
      type: fieldTypeToPlaceholderType(itemType),
      sample: iterationSample(scope, sourcePath, alias, alias),
      origin: "iteration",
    });
  }
}

function iterationSample(
  scope: ReturnType<typeof buildPreviewScope>,
  sourcePath: string,
  alias: string,
  fullPath: string,
): string | null {
  const list = walkPath(scope, sourcePath);
  if (!Array.isArray(list) || list.length === 0) return null;
  const enriched: Record<string, unknown> = { ...(scope as Record<string, unknown>), [alias]: list[0] };
  return renderSample(walkPath(enriched, fullPath));
}

function collectPagination(out: PlaceholderEntry[]): void {
  out.push({ path: "pagination.page", type: "integer", sample: "1", origin: "pagination" });
  out.push({ path: "pagination.totalPages", type: "integer", sample: "1", origin: "pagination" });
}
