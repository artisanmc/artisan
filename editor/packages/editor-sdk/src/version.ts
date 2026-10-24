/**
 * The version of the editor SDK, the contract a module compiles against (ADR
 * `runtime-editor-modules`). Same discipline as the Java API: the major changes when an
 * export changes meaning or goes away, the minor when one is added. A module bundle
 * declares the version it was built with; the editor loads it when the majors are equal
 * and its own minor is at least the bundle's.
 */
export const SDK_VERSION = "1.7.0";

const VERSION = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

/** `MAJOR.MINOR[.PATCH]` → its numbers, or null when it is not a version. */
export function parseSdkVersion(version: string): { major: number; minor: number } | null {
  const m = VERSION.exec(version.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/**
 * Whether a bundle built against `required` runs on an editor providing `provided`.
 * `"older-editor"`: the bundle needs a newer SDK (update Artisan); `"older-bundle"`:
 * the bundle targets a past major (update the module); `"invalid"`: not a version.
 */
export type SdkCompatibility = "compatible" | "older-editor" | "older-bundle" | "invalid";

export function sdkCompatibility(
  required: string,
  provided: string = SDK_VERSION,
): SdkCompatibility {
  const need = parseSdkVersion(required);
  const have = parseSdkVersion(provided);
  if (!need || !have) return "invalid";
  if (need.major > have.major) return "older-editor";
  if (need.major < have.major) return "older-bundle";
  return need.minor > have.minor ? "older-editor" : "compatible";
}
