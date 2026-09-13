import type { ProjectStorage } from "./ProjectStorage";
import { assertTreePaths, digest } from "./hostedFilesystem";

export const COPY_LIMITS = { files: 5000, total: 64 * 1024 * 1024, file: 16 * 1024 * 1024, chunk: 192 * 1024 };
export interface CapturedFile { path: string; size: number; sha256: string; contentBase64: string }
export interface CapturedSnapshot { revision: string; files: CapturedFile[] }
export class ProjectCopyError extends Error { constructor(readonly code: string) { super(code); } }

/** Public storage only. Binary reads must match the descriptors of the pinned text revision. */
export async function captureProjectSnapshot(storage: ProjectStorage, revision: string): Promise<CapturedSnapshot> {
  const read = await storage.read();
  if (read.kind !== "result" || !read.result.ok || !read.result.hash || read.result.failed?.length) throw new ProjectCopyError("source_incomplete");
  if (read.result.hash !== revision) throw new ProjectCopyError("source_revision_changed");
  const files: CapturedFile[] = [];
  let total = 0;
  const paths = [...(read.result.files ?? []), ...(read.result.binaries ?? [])].map(f => f.path);
  assertTreePaths(paths);
  if (paths.length > COPY_LIMITS.files) throw new ProjectCopyError("too_large");
  const append = (path: string, bytes: Uint8Array) => {
    total += bytes.length;
    if (bytes.length > COPY_LIMITS.file || total > COPY_LIMITS.total) throw new ProjectCopyError("too_large");
    files.push({ path, size: bytes.length, sha256: digest(bytes), contentBase64: Buffer.from(bytes).toString("base64") });
  };
  for (const file of read.result.files ?? []) append(file.path, Buffer.from(file.content, "utf8"));
  for (const ref of read.result.binaries ?? []) {
    if (ref.size > COPY_LIMITS.file || total + ref.size > COPY_LIMITS.total) throw new ProjectCopyError("too_large");
    const binary = await storage.readBinary(ref.path);
    if (binary.kind !== "result" || !binary.result.ok || binary.result.content === undefined || binary.result.content.length !== ref.size || digest(binary.result.content) !== ref.hash) throw new ProjectCopyError("source_revision_changed");
    append(ref.path, binary.result.content);
  }
  const after = await storage.read(revision);
  if (after.kind !== "result" || !after.result.ok || after.result.hash !== revision) throw new ProjectCopyError("source_revision_changed");
  return { revision, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}
