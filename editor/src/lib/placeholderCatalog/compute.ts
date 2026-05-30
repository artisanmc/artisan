import type { FieldType, Menu, Pack } from "@/domain/types";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
import { renderSample, sampleForPath, walkPath } from "./sample";
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
export function compute(pack: Pack, location: FieldLocation): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = pack.menus.find((m) => m.id === location.menuId);
      if (!menu) return [];
      const out: PlaceholderEntry[] = [];
      collectMenuContextInputs(menu, pack, out);
      if (location.kind === "element" || location.kind === "action") {
        const element = findElement(menu, location.elementId);
        if (element?.iterates) {
          collectIterationLeaves(element.iterates.source, element.iterates.alias, pack, menu.id, out);
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
      return [];
  }
}

function collectMenuContextInputs(
  menu: Menu,
  pack: Pack,
  out: PlaceholderEntry[],
): void {
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      const type = input.type as PlaceholderType;
      out.push({
        path: input.name,
        type,
        sample: sampleForPath(pack, menu.id, input.name),
        origin: "context",
      });
      continue;
    }
    // sourceRef
    const resolvedType = typeOfSourceRef(input.ref, pack);
    if (!resolvedType) {
      console.warn(
        `[placeholderCatalog] menu "${menu.id}" contextInput "${input.name}" → sourceRef "${input.ref}" points at a deleted dataSource/connector. Omitted.`,
      );
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
          sample: sampleForPath(pack, menu.id, path),
          origin: "context",
        });
      }
      continue;
    }
    // primitive leaf (string / integer / number / boolean)
    out.push({
      path: input.name,
      type: fieldTypeToPlaceholderType(resolvedType),
      sample: sampleForPath(pack, menu.id, input.name),
      origin: "context",
    });
  }
}

function typeOfSourceRef(ref: string, pack: Pack): FieldType | null {
  const r = String(ref);
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === id);
    return ds?.type ?? null;
  }
  const c = pack.importedConnectors.find((x) => x.ref === r);
  return c?.type ?? null;
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
  pack: Pack,
  menuId: string,
  out: PlaceholderEntry[],
): void {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return;
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
        sample: iterationSample(pack, menuId, sourcePath, alias, leafPath),
        origin: "iteration",
      });
    }
  } else {
    out.push({
      path: alias,
      type: fieldTypeToPlaceholderType(itemType),
      sample: iterationSample(pack, menuId, sourcePath, alias, alias),
      origin: "iteration",
    });
  }
}

function iterationSample(
  pack: Pack,
  menuId: string,
  sourcePath: string,
  alias: string,
  fullPath: string,
): string | null {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  const scope = buildPreviewScope(menu, pack);
  const list = walkPath(scope, sourcePath);
  if (!Array.isArray(list) || list.length === 0) return null;
  const enriched: Record<string, unknown> = { ...(scope as Record<string, unknown>), [alias]: list[0] };
  return renderSample(walkPath(enriched, fullPath));
}

function collectPagination(out: PlaceholderEntry[]): void {
  out.push({ path: "pagination.page", type: "integer", sample: "1", origin: "pagination" });
  out.push({ path: "pagination.totalPages", type: "integer", sample: "1", origin: "pagination" });
}
