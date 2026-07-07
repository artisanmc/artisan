import type { FrontendModule } from "./types";

const modules: FrontendModule[] = [];
const ids = new Set<string>();

export function registerModule(mod: FrontendModule): void {
  if (ids.has(mod.id)) {
    throw new Error(`duplicate module id: ${mod.id}`);
  }
  ids.add(mod.id);
  modules.push(mod);
}

export function listModules(): readonly FrontendModule[] {
  return modules;
}

export function getModule(id: string): FrontendModule | undefined {
  return modules.find((m) => m.id === id);
}

export function collectModuleExportFiles(project: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mod of listModules()) {
    if (!mod.exportFiles) continue;
    for (const [rel, content] of Object.entries(mod.exportFiles(project))) {
      if (!rel.startsWith(`${mod.id}/`)) continue;
      out[rel] = content;
    }
  }
  return out;
}

/** Test-only helper. Do not call from production code. */
export function clearRegistry(): void {
  modules.length = 0;
  ids.clear();
}
