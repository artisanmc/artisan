import type { Menu, Pack, SourceRef } from "@/domain/types";

/**
 * Resolve a SourceRef against a pack:
 *  - "pack:<id>" → pack.dataSources[id].value
 *  - "<plugin>:<source>" → pack.importedConnectors[ref].sample
 *  - unknown / malformed → undefined
 *
 * Cf. spec §3.5.
 */
export function resolveSourceRef(ref: SourceRef, pack: Pack): unknown {
  const r = String(ref);
  if (r === "" || !r.includes(":")) return undefined;
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === (id as Pack["dataSources"][number]["id"]));
    return ds?.value;
  }
  const c = pack.importedConnectors.find((x) => x.ref === r);
  return c?.sample;
}

/**
 * Build the preview scope for a menu by walking its contextInputs:
 *  - primitive → coerce default to its declared type
 *  - sourceRef → resolveSourceRef
 *
 * Used by MenuGroup and ItemTooltip preview rendering. Replaces the
 * pre-Plan-C1 sampleContext blob.
 */
export function buildPreviewScope(menu: Menu, pack: Pack): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      scope[input.name] = coerceDefault(input.default, input.type);
    } else {
      scope[input.name] = resolveSourceRef(input.ref, pack);
    }
  }
  return scope;
}

function coerceDefault(
  value: string | undefined,
  type: "player" | "string" | "integer" | "number" | "boolean",
): unknown {
  if (value === undefined || value === "") {
    switch (type) {
      case "player":
      case "string":
        return "";
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
    }
  }
  switch (type) {
    case "integer":
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === "true";
    default:
      return value;
  }
}
