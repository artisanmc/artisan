import type { Hono } from "hono";
import type { BackendModule } from "./types";

export interface ModuleRegistryHandle {
  ids: () => string[];
  get: (id: string) => BackendModule | undefined;
}

export function mountModules(app: Hono, modules: BackendModule[]): ModuleRegistryHandle {
  const seen = new Set<string>();
  const byId = new Map<string, BackendModule>();
  for (const m of modules) {
    if (seen.has(m.id)) {
      throw new Error(`duplicate module id: ${m.id}`);
    }
    seen.add(m.id);
    byId.set(m.id, m);
    m.registerRoutes(app);
  }
  return {
    ids: () => Array.from(byId.keys()),
    get: (id) => byId.get(id),
  };
}
