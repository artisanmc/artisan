import { parse as parseYaml } from "yaml";
import type { ShippedEntry } from "./types";

/** `artisan-shipped.yml` (ADR `editable-module-tree`), by path; undefined when absent or unreadable. */
export function readShippedIndex(text: string | null): Record<string, ShippedEntry> | undefined {
  if (text === null) return undefined;
  let y: { files?: unknown } | null = null;
  try {
    y = parseYaml(text) as { files?: unknown } | null;
  } catch {
    return undefined;
  }
  const filesNode = y?.files;
  if (!filesNode || typeof filesNode !== "object" || Array.isArray(filesNode)) return undefined;
  const out: Record<string, ShippedEntry> = {};
  for (const [path, raw] of Object.entries(filesNode as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const version = typeof e.version === "number" ? e.version : Number(e.version);
    if (
      typeof e.module !== "string" ||
      !e.module ||
      typeof e.template !== "string" ||
      !e.template ||
      typeof e.hash !== "string" ||
      !e.hash ||
      !(version > 0)
    )
      continue;
    out[path] = {
      module: e.module,
      template: e.template,
      version,
      hash: e.hash,
      ...(e.required === true ? { required: true } : {}),
    };
  }
  return out;
}
