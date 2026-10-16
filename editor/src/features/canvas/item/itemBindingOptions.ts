import { sourceRootFields } from "@/domain/dataModels";
import type { Element, Menu, ModelFieldType, Project } from "@/domain/types";
import type { ServerDataSource } from "@/lib/api/dataSources";

export function itemBindingOptions(
  project: Project,
  menu: Menu,
  element: Element,
  serverSources: ServerDataSource[] = [],
  sourceModels: Record<string, string> = {},
): string[] {
  const models = project.dataModels ?? [];
  const expand = (type: ModelFieldType | undefined): ModelFieldType | undefined =>
    type?.kind === "model"
      ? { kind: "object", fields: models.find((m) => m.id === type.ref)?.fields ?? [] }
      : type;
  const source = (ref: string): ModelFieldType | undefined => {
    const declared = models.find((m) => m.id === sourceModels[ref]);
    if (declared) return { kind: "list", of: { kind: "model", ref: declared.id } };
    const id = ref.startsWith(`${project.ownerModule}:`)
      ? ref.slice(ref.indexOf(":") + 1)
      : ref.replace(/^pack:/, "");
    const ds = project.dataSources.find((s) => s.id === id || s.name === id);
    if (ds) {
      const row: ModelFieldType = { kind: "object", fields: sourceRootFields(project, ds) };
      return ds.shape === "table" ? { kind: "list", of: row } : row;
    }
    const server = serverSources.find((s) => s.ref === ref);
    if (server)
      return {
        kind: "list",
        of: {
          kind: "object",
          fields: server.schema
            .filter((f) => f.type === "item")
            .map((f) => ({ name: f.name, type: { kind: "item" } })),
        },
      };
    const model = models.find((m) => m.id === ref);
    return model ? { kind: "object", fields: model.fields } : undefined;
  };
  const roots: Record<string, ModelFieldType> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "sourceRef") {
      const type = source(input.ref);
      if (type) roots[input.name] = type;
    } else if (input.rowOf) {
      const type = source(input.rowOf);
      if (type) {
        const row = type.kind === "list" ? type.of : type;
        roots[input.name] = input.type === "list" ? { kind: "list", of: row } : row;
      }
    }
  }
  const iteration = element.iterates ?? element.places;
  if (iteration) {
    const [root, ...path] = iteration.source.split(".");
    let type = roots[root!] ?? source(root!);
    for (const key of path) {
      type = expand(type);
      type = type?.kind === "object" ? type.fields.find((f) => f.name === key)?.type : undefined;
    }
    type = expand(type);
    if (type?.kind === "list") roots[iteration.alias] = type.of;
  }
  const out: string[] = [];
  const walk = (path: string, raw: ModelFieldType, seen: Set<string>) => {
    if (raw.kind === "model" && seen.has(raw.ref)) return;
    const next = new Set(seen);
    if (raw.kind === "model") next.add(raw.ref);
    const type = expand(raw);
    if (type?.kind === "item") out.push(path);
    if (type?.kind === "object")
      for (const field of type.fields) walk(`${path}.${field.name}`, field.type, next);
  };
  for (const [path, type] of Object.entries(roots)) walk(path, type, new Set());
  return [...new Set(out)].sort();
}
