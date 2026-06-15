/**
 * `@artisan/backend-sdk` — the public surface a backend module compiles
 * against. Modules import ONLY from this entrypoint, never from deep backend
 * paths (`../modules/api/...`).
 *
 * M1 scope: module-system contract only, re-exported from the in-repo
 * implementation. No physical npm package / publish yet (cf. spec §6.2, §10).
 *
 * Resolved via the `@artisan/backend-sdk` tsconfig path — Bun honours tsconfig
 * paths natively, including under `bun test`.
 */
export type { BackendModule, DataSourceDeclaration, CommandDeclaration } from "../modules/api/types";
export { mountModules } from "../modules/api/moduleRegistry";
export type { ModuleRegistryHandle } from "../modules/api/moduleRegistry";
