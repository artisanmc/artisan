import type { ServerDataSource } from "@/lib/api/dataSources";

/** V1 core modules — their groups sort before Add-on groups (spec §3). */
export const CORE_MODULE_IDS = ["commands", "menus"];

export interface ServerSourceGroup {
  /** null = sources registered outside a module ("Serveur" group, rendered last). */
  moduleId: string | null;
  sources: ServerDataSource[];
}

export function groupServerSources(sources: ServerDataSource[]): ServerSourceGroup[] {
  const byModule = new Map<string | null, ServerDataSource[]>();
  for (const s of sources) {
    const key = s.moduleId ?? null;
    const list = byModule.get(key) ?? [];
    list.push(s);
    byModule.set(key, list);
  }
  const rank = (id: string | null): number =>
    id === null ? 2 : CORE_MODULE_IDS.includes(id) ? 0 : 1;
  return [...byModule.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a ?? "").localeCompare(b ?? ""))
    .map(([moduleId, list]) => ({
      moduleId,
      sources: [...list].sort((x, y) => x.ref.localeCompare(y.ref)),
    }));
}
