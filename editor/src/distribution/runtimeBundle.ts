import { type FrontendModule, SDK_VERSION, sdkCompatibility } from "@artisan/editor-sdk";
// The asm.js build: synchronous, no WebAssembly to compile (nor to allow).
import { parse } from "es-module-lexer/js";
import { SHARED_MODULES } from "./sharedModules";

/**
 * Module bundles served by the server (ADR `runtime-editor-modules`): a module's jar
 * carries the JS of its editor view, the hub serves it on
 * `/api/v1/servers/:server/modules/:module/ui.js`, and the editor imports it here.
 *
 * A bundle is one ES module whose only imports are the editor's shared modules
 * (`SHARED_MODULES`). Their bare specifiers mean nothing to the browser, and an import
 * map cannot be added once the editor runs, so each one is rewritten to a small module
 * re-exporting the editor's own instance, then the bundle is imported from a blob URL.
 */

/** Why a bundle was not loaded: the editor shows it instead of a broken view. */
export type BundleRefusal =
  | { reason: "older-editor"; sdk: string }
  | { reason: "older-bundle"; sdk: string }
  | { reason: "invalid"; detail: string }
  | { reason: "fetch"; detail: string };

export class BundleError extends Error {
  constructor(readonly refusal: BundleRefusal) {
    super(
      refusal.reason === "older-editor" || refusal.reason === "older-bundle"
        ? `${refusal.reason}: bundle built against SDK ${refusal.sdk}, editor provides ${SDK_VERSION}`
        : `${refusal.reason}: ${refusal.detail}`,
    );
  }
}

/** A bundle as a server announces it, in `installed_modules[].editor_bundle`. */
export interface AnnouncedBundle {
  sdk: string;
  hash: string;
}

/** Refuses a bundle the editor cannot run, before downloading it. */
export function checkBundleSdk(sdk: string): void {
  const compat = sdkCompatibility(sdk);
  if (compat === "compatible") return;
  if (compat === "invalid")
    throw new BundleError({ reason: "invalid", detail: `SDK version "${sdk}"` });
  throw new BundleError({ reason: compat, sdk });
}

const GLOBAL = "__ARTISAN_EDITOR_SHARED__";
const IDENT = /^[A-Za-z_$][\w$]*$/;
const shimUrls = new Map<string, string>();

/** The source of the module standing for `specifier`: the editor's instance, re-exported. */
export function sharedShimSource(specifier: string, namespace: object): string {
  const names = Object.keys(namespace).filter((n) => n !== "default" && IDENT.test(n));
  const ref = `globalThis.${GLOBAL}[${JSON.stringify(specifier)}]`;
  const lines = [`const m = ${ref};`, "export default m.default ?? m;"];
  for (const name of names) lines.push(`export const ${name} = m[${JSON.stringify(name)}];`);
  return lines.join("\n");
}

function shimUrl(specifier: string): string {
  let url = shimUrls.get(specifier);
  if (!url) {
    const g = globalThis as unknown as Record<string, Record<string, object>>;
    g[GLOBAL] ??= {};
    g[GLOBAL][specifier] = SHARED_MODULES[specifier]!;
    url = URL.createObjectURL(
      new Blob([sharedShimSource(specifier, SHARED_MODULES[specifier]!)], {
        type: "text/javascript",
      }),
    );
    shimUrls.set(specifier, url);
  }
  return url;
}

/**
 * The bundle with each shared import pointed at `resolve(specifier)`. Refuses an import
 * of anything else: a relative one (the bundle was split in chunks) or a package the
 * editor does not share (the bundle was built without inlining it).
 */
export async function rewriteBundleImports(
  code: string,
  resolve: (specifier: string) => string,
): Promise<string> {
  let imports: ReturnType<typeof parse>[0];
  try {
    [imports] = parse(code);
  } catch (e) {
    throw new BundleError({
      reason: "invalid",
      detail: `not an ES module (${(e as Error).message})`,
    });
  }
  let out = "";
  let last = 0;
  for (const imp of imports) {
    // `import.meta` (d = -2) is not an import; a dynamic import of a computed value has no name.
    if (imp.d === -2) continue;
    const specifier = imp.n;
    if (specifier === undefined) {
      throw new BundleError({
        reason: "invalid",
        detail: "dynamic import of a computed specifier",
      });
    }
    if (!(specifier in SHARED_MODULES)) {
      throw new BundleError({
        reason: "invalid",
        detail: `imports "${specifier}", which the editor does not provide (bundle it, or build as one file)`,
      });
    }
    // A static import's [s, e) is the bare specifier; a dynamic one's includes the quotes.
    const quoted = imp.d > -1;
    out +=
      code.slice(last, imp.s) + (quoted ? JSON.stringify(resolve(specifier)) : resolve(specifier));
    last = imp.e;
  }
  return out + code.slice(last);
}

/** Checks what a bundle's default export claims to be before it is registered. */
export function validateBundleModule(mod: unknown, moduleId: string): FrontendModule {
  const m = mod as Partial<FrontendModule> | null;
  if (!m || typeof m !== "object") {
    throw new BundleError({ reason: "invalid", detail: "no default export" });
  }
  if (m.id !== moduleId) {
    throw new BundleError({
      reason: "invalid",
      detail: `declares module "${String(m.id)}", served as "${moduleId}"`,
    });
  }
  if (typeof m.displayName !== "string" || !Array.isArray(m.routes) || !m.sidebar) {
    throw new BundleError({ reason: "invalid", detail: "not a FrontendModule" });
  }
  if (m.sdk !== undefined) checkBundleSdk(m.sdk);
  return m as FrontendModule;
}

export function bundleUrl(serverId: string, moduleId: string, hash: string): string {
  return `/api/v1/servers/${encodeURIComponent(serverId)}/modules/${encodeURIComponent(moduleId)}/ui.js?v=${encodeURIComponent(hash)}`;
}

/** Downloads, links and imports a module's bundle; its default export, checked. */
export async function loadRuntimeBundle(
  serverId: string,
  moduleId: string,
  bundle: AnnouncedBundle,
): Promise<FrontendModule> {
  checkBundleSdk(bundle.sdk);
  let code: string;
  try {
    const res = await fetch(bundleUrl(serverId, moduleId, bundle.hash), {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    code = await res.text();
  } catch (e) {
    throw new BundleError({ reason: "fetch", detail: (e as Error).message });
  }
  const linked = await rewriteBundleImports(code, shimUrl);
  const url = URL.createObjectURL(new Blob([linked], { type: "text/javascript" }));
  try {
    const ns = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    return validateBundleModule(ns.default, moduleId);
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError({ reason: "invalid", detail: (e as Error).message });
  } finally {
    URL.revokeObjectURL(url);
  }
}
