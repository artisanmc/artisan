import { createHash } from "node:crypto";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Byte-order-compatible with BundleHasher.hashFiles, without locale collation. */
export function computeBundleHash(files: Record<string, string>): string {
  const paths = Object.keys(files).sort();
  return paths.length ? sha256(paths.map((path) => `${path}\n${files[path]}\n`).join("")) : "";
}
export function computeProjectSnapshotHash(
  files: Record<string, string>,
  binaries: Record<string, string>,
  failed: Record<string, string> = {},
): string {
  const entries: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) entries[`f/${path}`] = content;
  for (const [path, hash] of Object.entries(binaries)) entries[`b/${path}`] = hash;
  for (const [path, reason] of Object.entries(failed)) entries[`x/${path}`] = reason;
  return Object.keys(entries).length ? computeBundleHash(entries) : sha256("vide");
}
