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

/** Test-only helper. Do not call from production code. */
export function clearRegistry(): void {
  modules.length = 0;
  ids.clear();
}
