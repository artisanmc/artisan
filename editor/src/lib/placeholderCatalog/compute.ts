import { commandNodeAt } from "@/domain/commandNodes";
import { sourceFieldType } from "@/domain/dataModels";
import { commandsOf, menusOf } from "@/domain/documents";
import type { FieldType, Menu, Project } from "@/domain/types";
import {
  SAMPLE_PLAYER_NAME,
  SAMPLE_PLAYER_UUID,
  SAMPLE_PLAYER_WORLD,
  buildPreviewScope,
} from "@/features/canvas/menuPreviewScope";
import { renderSample, walkPath } from "./sample";
import type { FieldLocation, PlaceholderEntry, PlaceholderOrigin, PlaceholderType } from "./types";

const ORDER: Record<PlaceholderOrigin, number> = {
  context: 0,
  iteration: 1,
  source: 2,
};

/**
 * Walk the project and the requested location to produce a flat list of
 * placeholder entries the user can insert in this field. Pure — no
 * side effects, safe to call from useMemo.
 */
/** Field schemas of server-reported sources, keyed by ref — lets `rowOf`-typed
 *  context inputs expose their fields without compute() touching any store. */
export type RowModelSchemas = Record<string, { name: string; type: string }[]>;

export function compute(
  project: Project,
  location: FieldLocation,
  rowSchemas?: RowModelSchemas,
): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = menusOf(project).find((m) => m.id === location.menuId);
      if (!menu) return [];
      // Build the preview scope once; thread it through all helpers.
      const scope = buildPreviewScope(menu, project);
      const out: PlaceholderEntry[] = [];
      // Builtin implicit {player} = the viewing player, unless the menu
      // declares a contextInput named `player` (caller arg wins, like the
      // plugin runtime — the declared input's own entries show instead).
      if (!(menu.contextInputs ?? []).some((i) => i.name === "player")) {
        out.push(...builtinPlayerEntries());
      }
      out.push(...builtinNavigationEntries());
      collectMenuContextInputs(menu, project, scope, out, rowSchemas);
      if (location.kind === "element" || location.kind === "action") {
        const element = findElement(menu, location.elementId);
        // Placement binds its alias exactly like an iteration (MenuRenderer).
        const iteration = element?.iterates ?? element?.places;
        if (iteration) {
          collectIterationLeaves(
            iteration.source,
            iteration.alias,
            project,
            menu,
            scope,
            out,
            rowSchemas,
          );
        }
      }
      return sorted(out);
    }
    case "command": {
      const command = commandsOf(project).find((c) => c.id === location.commandId);
      const out: PlaceholderEntry[] = [];
      // A sub-command's chain sees its own arguments: the words before them chose the node.
      const args = (command && commandNodeAt(command, location.sub)?.arguments) ?? [];
      if (!args.some((a) => a.name === "player")) out.push(...builtinPlayerEntries());
      for (const arg of args) {
        out.push({ path: arg.name, type: arg.type, sample: null, origin: "context" });
        if (arg.type === "player") out.push(...playerSubfieldEntries(arg.name, null));
      }
      return sorted(out);
    }
    case "dialog":
    case "dialog-action":
      // Dialogs have no contextInputs yet — the builtin {player} and the
      // navigation placeholders are still in scope at runtime, so the popup is
      // never empty.
      return sorted([...builtinPlayerEntries(), ...builtinNavigationEntries()]);
    case "event":
      return sorted([...builtinPlayerEntries(), ...location.values]);
  }
}

function sorted(out: PlaceholderEntry[]): PlaceholderEntry[] {
  return out.sort((a, b) => {
    if (ORDER[a.origin] !== ORDER[b.origin]) return ORDER[a.origin] - ORDER[b.origin];
    return a.path.localeCompare(b.path);
  });
}

/** The implicit `{player}` entries available everywhere at runtime. */
function builtinPlayerEntries(): PlaceholderEntry[] {
  return [
    { path: "player", type: "player", sample: SAMPLE_PLAYER_NAME, origin: "context" },
    ...playerSubfieldEntries("player", SAMPLE_PLAYER_NAME),
  ];
}

/**
 * The navigation-history placeholders, available everywhere a screen renders.
 * `has_previous_menu` guards a back button (a condition); `previous_menu` is the
 * screen `open_previous_menu` would return to.
 */
function builtinNavigationEntries(): PlaceholderEntry[] {
  return [
    { path: "has_previous_menu", type: "boolean", sample: "true", origin: "context" },
    { path: "previous_menu", type: "object", sample: null, origin: "context" },
    { path: "previous_menu.id", type: "string", sample: null, origin: "context" },
    { path: "previous_menu.title", type: "string", sample: null, origin: "context" },
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
  project: Project,
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
        out.push(
          ...playerSubfieldEntries(input.name, sampleFromScope(scope, `${input.name}.name`)),
        );
      }
      // Row-model input (`rowOf`): expose the source's fields as subpaths —
      // {cat.name}, {cat.id}… typed from the declared schema.
      if (input.type === "object" && input.rowOf) {
        for (const f of rowSchemaFields(String(input.rowOf), project, rowSchemas)) {
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
    const resolvedType = typeOfSourceRef(input.ref, project);
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

/** Declared field schema of a source ref: server report first, then project data. */
function rowSchemaFields(
  ref: string,
  project: Project,
  rowSchemas?: RowModelSchemas,
): { name: string; type: string }[] {
  const server = rowSchemas?.[ref];
  if (server && server.length > 0) return server;
  if (ref.startsWith("pack:")) {
    const t = typeOfSourceRef(ref, project);
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

function typeOfSourceRef(ref: string, project: Project): FieldType | null {
  if (ref.startsWith("pack:")) {
    const id = ref.slice("pack:".length);
    const ds = project.dataSources.find((d) => d.id === id);
    return ds ? sourceFieldType(project, ds) : null;
  }
  // Server refs: no design-time FieldType — the schema comes from the server
  // report (serverDataSourcesStore), not the project. Unknown here.
  return null;
}

function fieldTypeToPlaceholderType(t: FieldType): PlaceholderType {
  switch (t.kind) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "list":
      return "list";
    case "object":
      return "object";
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
  project: Project,
  menu: Menu,
  scope: ReturnType<typeof buildPreviewScope>,
  out: PlaceholderEntry[],
  rowSchemas?: RowModelSchemas,
): void {
  const sourceInput = (menu.contextInputs ?? []).find(
    (i) => i.kind === "sourceRef" && i.name === sourcePath,
  );
  // Direct-ref sugar: `source: "ns:id"` names the source itself.
  const ref =
    sourceInput?.kind === "sourceRef"
      ? sourceInput.ref
      : sourcePath.includes(":")
        ? sourcePath
        : null;
  if (!ref) return;
  const type = typeOfSourceRef(ref, project);
  if (!type) {
    for (const field of rowSchemaFields(ref, project, rowSchemas)) {
      const leafPath = `${alias}.${field.name}`;
      out.push({
        path: leafPath,
        type: fieldKindToPlaceholderType(field.type),
        sample: iterationSample(scope, sourcePath, alias, leafPath),
        origin: "iteration",
      });
    }
    return;
  }
  if (type.kind !== "list") return;
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
  const enriched: Record<string, unknown> = {
    ...(scope as Record<string, unknown>),
    [alias]: list[0],
  };
  return renderSample(walkPath(enriched, fullPath));
}
