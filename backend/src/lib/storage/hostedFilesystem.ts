import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { sql } from "drizzle-orm";
import { storageTransaction } from "./storageTransaction";

export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const logicalId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
export const physicalId = (id: string) =>
  /^[a-z0-9_-]+$/.test(id) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)
    ? id
    : `%${digest(id)}`;
export const isBinaryPath = (path: string) => /\.(png|zip|jpg|jpeg|ogg|ttf|otf)$/i.test(path);
export function publicPath(path: string): boolean {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\:*?"<>|]/.test(path) &&
    Array.from(path).every((character) => character.charCodeAt(0) >= 32) &&
    path
      .split("/")
      .every(
        (p, i) =>
          p &&
          p !== "." &&
          p !== ".." &&
          !/[. ]$/.test(p) &&
          !["__proto__", "constructor", "prototype"].includes(p) &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p) &&
          (!p.startsWith(".") || (i === 0 && path === ".artisan/editor.yaml")),
      )
  );
}
export function publicPhysicalPath(path: string) {
  if (!publicPath(path)) throw new Error("invalid_path");
  return path;
}
export function assertTreePaths(paths: string[]) {
  const lower = new Set<string>();
  for (const p of paths) {
    if (!publicPath(p) || lower.has(p.toLowerCase())) throw new Error("invalid_path");
    lower.add(p.toLowerCase());
  }
  for (const p of lower) {
    const parts = p.split("/");
    parts.pop();
    while (parts.length) {
      if (lower.has(parts.join("/"))) throw new Error("invalid_path");
      parts.pop();
    }
  }
}
export async function safeTree(root: string) {
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe_storage_path");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    const stat = await lstat(p);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error("unsafe_storage_path");
    if (stat.isDirectory()) await safeTree(p);
  }
}
export async function durableWrite(path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path: string) {
  // Windows does not expose fsync(directory); rename is still the activation boundary.
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function syncTree(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) await syncTree(target);
    else {
      const handle = await open(target, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  await syncDirectory(path);
}
export interface HostedState {
  schema: "artisan-hosted/v1";
  folderName: string;
  files: Record<string, { hash: string; size: number; binary: boolean }>;
  drafts: string[];
  receipts: Record<string, { fingerprint: string; at: number; result?: unknown; ownerId?: string }>;
  history: Record<string, { at: number; file: string; binary: boolean }[]>;
  deleted?: boolean;
  demoActivityAt?: number;
  demoMutationTimes?: number[];
}
export interface HostedRevision {
  directory: string;
  state: HostedState;
}
export interface HostedUsage {
  publishedBytes: number;
  stagedBytes: number;
  totalBytes: number;
  stagedFiles: number;
  totalFiles: number;
}
export async function measureHostedTree(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("unsafe_storage_path");
    if (entry.isDirectory()) {
      const child = await measureHostedTree(target);
      bytes += child.bytes;
      files += child.files;
    } else {
      bytes += info.size;
      files++;
    }
  }
  return { bytes, files };
}
export class HostedFilesystem {
  readonly directory: string;
  constructor(
    readonly volumeRoot: string,
    readonly rootId: string,
    private readonly checkpoint?: (step: string) => Promise<void>,
    private readonly beforeActivate?: (usage: HostedUsage) => Promise<void>,
    private readonly beforeLock?: () => Promise<void>,
    private readonly beforeCommit?: (previous: HostedRevision | undefined, next: HostedRevision) => Promise<void>,
  ) {
    if (!logicalId(rootId)) throw new Error("invalid_location");
    this.directory = resolve(volumeRoot, physicalId(rootId));
    if (!this.directory.startsWith(resolve(volumeRoot) + sep)) throw new Error("invalid_location");
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    return storageTransaction(async (tx) => {
      await this.beforeLock?.();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hosted:${this.rootId}`}))`);
      return fn();
    });
  }
  async current(): Promise<HostedRevision> {
    await safeTree(this.directory);
    const id = (await readFile(join(this.directory, "current"), "utf8")).trim();
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid_revision");
    const directory = join(this.directory, "revisions", id);
    const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as HostedState;
    if (
      state.schema !== "artisan-hosted/v1" ||
      !logicalId(state.folderName) ||
      !publicPath(state.folderName)
    )
      throw new Error("invalid_revision");
    await safeTree(join(directory, state.folderName));
    assertTreePaths(Object.keys(state.files));
    if (!Array.isArray(state.drafts) || state.drafts.some((id) => !logicalId(id)))
      throw new Error("invalid_revision");
    for (const [path, entries] of Object.entries(state.history))
      if (!publicPath(path) || entries.some((e) => !/^[a-f0-9-]{36}$/.test(e.file)))
        throw new Error("invalid_revision");
    for (const [path, entry] of Object.entries(state.files)) {
      const bytes = await readFile(join(directory, state.folderName, publicPhysicalPath(path)));
      if (
        bytes.length !== entry.size ||
        digest(bytes) !== entry.hash ||
        entry.binary !== isBinaryPath(path)
      )
        throw new Error("revision_content_mismatch");
    }
    const inspect = async (dir: string, prefix = "") => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix + e.name;
        if (e.isDirectory()) {
          if (rel === ".artisan") {
            const editor = join(dir, e.name, "editor.yaml");
            try {
              await lstat(editor);
              if (!state.files[".artisan/editor.yaml"])
                throw new Error("revision_content_mismatch");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            continue;
          }
          await inspect(join(dir, e.name), `${rel}/`);
        } else if (!state.files[rel]) throw new Error("revision_content_mismatch");
      }
    };
    await inspect(join(directory, state.folderName));
    return { directory, state };
  }
  async initialize(folderName: string) {
    if (!logicalId(folderName) || !publicPath(folderName)) throw new Error("invalid_location");
    await mkdir(this.volumeRoot, { recursive: true });
    const rootInfo = await lstat(this.volumeRoot);
    if (rootInfo.isSymbolicLink()) throw new Error("unsafe_storage_path");
    await mkdir(this.directory, { recursive: true });
    let pointerExists = true;
    try {
      await lstat(join(this.directory, "current"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      pointerExists = false;
    }
    if (pointerExists) {
      const current = await this.current();
      await rm(join(this.directory, "initializing"), { force: true });
      return current;
    }
    const entries = await readdir(this.directory);
    if (entries.length) {
      await safeTree(this.directory);
      let initializing = "";
      try {
        initializing = await readFile(join(this.directory, "initializing"), "utf8");
      } catch {}
      if (initializing !== "artisan-hosted-init/v1")
        throw new Error("incomplete_root_requires_recovery");
    } else await durableWrite(join(this.directory, "initializing"), "artisan-hosted-init/v1");
    const state: HostedState = {
      schema: "artisan-hosted/v1",
      folderName,
      files: {},
      drafts: [],
      receipts: {},
      history: {},
    };
    await this.commit(undefined, async (revision) => {
      revision.state = state;
      await mkdir(join(revision.directory, folderName));
      return undefined;
    });
    await rm(join(this.directory, "initializing"));
    await this.collect();
    return this.current();
  }
  async commit<T>(
    previous: HostedRevision | undefined,
    mutate: (revision: HostedRevision) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();
    const directory = join(this.directory, "revisions", id);
    const pointer = join(this.directory, `current.${id}`);
    let activated = false;
    try {
      if (previous) {
        await this.collect();
        await safeTree(previous.directory);
        await cp(previous.directory, directory, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } else await mkdir(directory, { recursive: true });
      const revision: HostedRevision = {
        directory,
        state: previous ? structuredClone(previous.state) : ({} as HostedState),
      };
      const result = await mutate(revision);
      await this.beforeCommit?.(previous, revision);
      for (const receipt of Object.values(revision.state.receipts))
        if (receipt.at < Date.now() - 86_400_000) receipt.result = undefined;
      await durableWrite(join(directory, "state.json"), JSON.stringify(revision.state));
      if (this.beforeActivate) {
        const staged = await measureHostedTree(directory);
        const total = await measureHostedTree(this.directory);
        await this.beforeActivate({
          publishedBytes: previous ? (await measureHostedTree(previous.directory)).bytes : 0,
          stagedBytes: staged.bytes,
          totalBytes: total.bytes,
          stagedFiles: staged.files,
          totalFiles: total.files,
        });
      }
      await syncTree(directory);
      await this.checkpoint?.("staged");
      await durableWrite(pointer, id);
      await this.checkpoint?.("before_activate");
      await rename(pointer, join(this.directory, "current"));
      activated = true;
      await syncDirectory(this.directory);
      await this.checkpoint?.("activated");
      return result;
    } catch (error) {
      if (!activated) {
        if (!directory.startsWith(this.directory + sep)) throw new Error("unsafe_storage_path");
        await rm(directory, { recursive: true, force: true });
        await rm(pointer, { force: true });
      }
      throw error;
    }
  }
  /** Run while holding the same project lock; the current revision is the complete reference set. */
  async collect() {
    const current = await this.current();
    for (const entry of await readdir(join(this.directory, "revisions"))) {
      const path = resolve(this.directory, "revisions", entry);
      if (
        path === current.directory ||
        !/^[a-f0-9-]{36}$/.test(entry) ||
        !path.startsWith(this.directory + sep)
      )
        continue;
      await safeTree(path);
      await rm(path, { recursive: true });
    }
    for (const entry of await readdir(this.directory))
      if (/^current\.[a-f0-9-]{36}$/.test(entry)) await rm(join(this.directory, entry));
  }
}
