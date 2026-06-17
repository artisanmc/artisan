import { type FrontendModule, getModule } from "@artisan/editor-sdk";

/** Active module ids → the FrontendModules that have a routable screen. */
export function selectModuleNavEntries(ids: string[]): FrontendModule[] {
  return ids
    .map((id) => getModule(id))
    .filter((m): m is FrontendModule => !!m && m.routes.length > 0);
}
