import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { applyRenames, planWrite } from "../../../../editor/src/features/project/diskSave";
import type { AssetWriteResultMessage, ProjectWriteResultMessage } from "../../protocol";
import { computeProjectSnapshotHash } from "../hashUtils";
import { validDraftBody } from "../projectDrafts";
import type { Project } from "../projectStorage";
import type { DraftBody, DraftOutcome, DraftResult, DraftStore, StoredDraft } from "./DraftStore";
import type {
  BinaryWrite,
  ProjectStorage,
  ProjectWriteBatch,
  StorageOutcome,
} from "./ProjectStorage";
import {
  HostedFilesystem,
  type HostedRevision,
  type HostedUsage,
  assertTreePaths,
  digest,
  durableWrite,
  isBinaryPath,
  logicalId,
  physicalId,
  publicPath,
  publicPhysicalPath,
} from "./hostedFilesystem";

export interface HostedStorageOptions {
  volumeRoot?: string;
  rootId: string;
  folderName: string;
  projectId: string;
  ownerId: string;
  checkpoint?: (step: string) => Promise<void>;
  beforeActivate?: (usage: HostedUsage) => Promise<void>;
  beforeLock?: () => Promise<void>;
  beforeCommit?: (previous: HostedRevision | undefined, next: HostedRevision) => Promise<void>;
  rename?: ProjectStorage["rename"];
}
const result = <T>(value: T) => ({ kind: "result" as const, result: value });
const fail = (error: string): DraftResult => ({ ok: false, error });
const filePath = (revision: HostedRevision, path: string) =>
  join(revision.directory, revision.state.folderName, publicPhysicalPath(path));
const draftPath = (revision: HostedRevision, id: string) =>
  join(
    revision.directory,
    revision.state.folderName,
    ".artisan",
    "drafts",
    physicalId(id),
    "draft.json",
  );
const blobPath = (revision: HostedRevision, id: string, hash: string) =>
  join(
    revision.directory,
    revision.state.folderName,
    ".artisan",
    "drafts",
    physicalId(id),
    "blobs",
    hash,
  );

/** One active revision contains canonical files and private envelopes, with no SQL content copy. */
export class HostedProjectStorage implements ProjectStorage {
  readonly capabilities = Object.freeze({
    canCopyToServer: true,
    canRename: true,
    liveData: false,
    captureInGame: false,
    preview: true,
  });
  readonly drafts: DraftStore;
  readonly filesystem: HostedFilesystem;
  private constructor(readonly options: HostedStorageOptions) {
    if (!logicalId(options.folderName) || !options.ownerId) throw new Error("invalid_location");
    this.filesystem = new HostedFilesystem(
      options.volumeRoot ?? process.env.HOSTED_PROJECTS_DIR ?? resolve("data/hosted-projects"),
      options.rootId,
      options.checkpoint,
      options.beforeActivate,
      options.beforeLock,
      options.beforeCommit,
    );
    this.drafts = new HostedDraftStore(this, options.ownerId);
  }
  static async open(options: HostedStorageOptions): Promise<HostedProjectStorage> {
    const storage = new HostedProjectStorage(options);
    await storage.filesystem.locked(async () => {
      await storage.filesystem.current();
    });
    return storage;
  }
  static async initialize(options: HostedStorageOptions): Promise<HostedProjectStorage> {
    const storage = new HostedProjectStorage(options);
    await storage.filesystem.locked(() => storage.filesystem.initialize(options.folderName));
    return storage;
  }
  async rename(operationId: string, targetId: string) {
    if (!this.options.rename) throw new Error("rename_lifecycle_required");
    return this.options.rename(operationId, targetId);
  }
  async purgeOwners(owners: string[]) {
    const deleted = new Set(owners);
    await this.filesystem.locked(async () => {
      const current = await this.filesystem.current();
      const ids: string[] = [];
      for (const id of current.state.drafts) {
        const draft = JSON.parse(await readFile(draftPath(current, id), "utf8")) as StoredDraft;
        if (deleted.has(draft.ownerId)) ids.push(id);
      }
      if (
        !ids.length &&
        !Object.values(current.state.receipts).some(
          (r) => r.ownerId && deleted.has(r.ownerId) && r.result,
        )
      )
        return;
      await this.filesystem.commit(current, async (next) => {
        for (const id of ids) {
          const path = dirname(draftPath(next, id));
          await rm(path, { recursive: true, force: true });
        }
        next.state.drafts = next.state.drafts.filter((id) => !ids.includes(id));
        for (const receipt of Object.values(next.state.receipts))
          if (receipt.ownerId && deleted.has(receipt.ownerId)) receipt.result = undefined;
      });
      await this.filesystem.collect();
    });
  }
  async remapDraftOwner(from: string, to: string) {
    await this.filesystem.locked(async () => {
      const current = await this.filesystem.current();
      const changes: StoredDraft[] = [];
      for (const id of current.state.drafts) {
        const draft = JSON.parse(await readFile(draftPath(current, id), "utf8")) as StoredDraft;
        if (draft.ownerId === from) changes.push({ ...draft, ownerId: to, updatedBy: draft.updatedBy === from ? to : draft.updatedBy });
      }
      if (!changes.length) return;
      await this.filesystem.commit(current, async next => {
        for (const draft of changes) await durableWrite(draftPath(next, draft.id), JSON.stringify(draft));
        // Guest operation keys/fingerprints must never replay as account operations.
        for (const receipt of Object.values(next.state.receipts)) if (receipt.ownerId === from) receipt.result = undefined;
      });
      await this.filesystem.collect();
    });
  }
  async read(ifHash: string | null = null) {
    return this.filesystem.locked(async () => {
      const revision = await this.filesystem.current();
      if (revision.state.deleted || revision.state.folderName !== this.options.folderName)
        return result({ ok: false, error: "unknown_project" as const });
      const paths = Object.keys(revision.state.files).sort();
      assertTreePaths(paths);
      const files: { path: string; content: string }[] = [];
      const binaries: { path: string; hash: string; size: number }[] = [];
      for (const path of paths) {
        const entry = revision.state.files[path]!;
        if (entry.binary) binaries.push({ path, hash: entry.hash, size: entry.size });
        else
          files.push({
            path,
            content: await readFile(filePath(revision, path), "utf8"),
          });
      }
      const hash = computeProjectSnapshotHash(
        Object.fromEntries(files.map((f) => [f.path, f.content])),
        Object.fromEntries(binaries.map((f) => [f.path, f.hash])),
      );
      if (ifHash === hash) return result({ ok: true, hash, unchanged: true });
      return result({ ok: true, hash, files, binaries });
    });
  }
  async readBinary(path: string) {
    if (!publicPath(path)) return result({ ok: false, error: "invalid_path" as const });
    return this.filesystem.locked(async () => {
      const revision = await this.filesystem.current();
      if (revision.state.deleted || revision.state.folderName !== this.options.folderName)
        return result({ ok: false, error: "unknown_project" as const });
      const entry = revision.state.files[path];
      if (!entry) return result({ ok: false, error: "not_found" as const });
      return result({
        ok: true,
        content: new Uint8Array(await readFile(filePath(revision, path))),
        hash: entry.hash,
      });
    });
  }
  async history(path: string) {
    if (!publicPath(path)) return result({ ok: false, error: "invalid_path" as const });
    return this.filesystem.locked(async () => {
      const revision = await this.filesystem.current();
      if (revision.state.deleted || revision.state.folderName !== this.options.folderName)
        return result({ ok: false, error: "unknown_project" as const });
      const versions = [];
      for (const entry of revision.state.history[path] ?? [])
        if (!entry.binary)
          versions.push({
            at: entry.at,
            content: await readFile(
              join(
                revision.directory,
                revision.state.folderName,
                ".artisan",
                "history",
                entry.file,
              ),
              "utf8",
            ),
          });
      return result({ ok: true, versions });
    });
  }
  async write(batch: ProjectWriteBatch): Promise<StorageOutcome<ProjectWriteResultMessage>> {
    return this.filesystem.locked(async () => {
      const current = await this.filesystem.current();
      if (current.state.deleted || current.state.folderName !== this.options.folderName)
        return result({ ok: false, error: "unknown_project" });
      const fingerprint = digest(JSON.stringify(batch));
      const key = batch.operationId ? digest(`public:${batch.operationId}`) : undefined;
      if (key) {
        const prior = current.state.receipts[key];
        if (prior)
          return result(
            prior.fingerprint === fingerprint && prior.result
              ? (prior.result as Omit<ProjectWriteResultMessage, "type" | "request_id">)
              : {
                  ok: false,
                  error: "write_error",
                  message:
                    prior.fingerprint === fingerprint ? "operation_expired" : "operation_mismatch",
                },
          );
      }
      const checked = await this.checkBatch(current, batch);
      if (!checked.ok) return result(checked);
      const out = { ok: true };
      await this.filesystem.commit(current, async (next) => {
        await this.applyBatch(next, batch);
        if (key)
          next.state.receipts[key] = {
            fingerprint,
            at: Date.now(),
            result: out,
          };
      });
      await this.filesystem.collect();
      return result(out);
    });
  }
  async writeBinaries(files: BinaryWrite[]): Promise<StorageOutcome<AssetWriteResultMessage>> {
    const outcome = await this.write({ files: [], binaries: files });
    if (outcome.kind !== "result") return outcome;
    const value = outcome.result;
    if (value.ok) return result({ ok: true });
    return result({
      ok: false,
      error: value.error === "plugin_update_required" ? "write_error" : value.error,
      message: value.message,
      conflicts: value.conflicts?.map((c) => ({
        path: c.path,
        disk_hash: c.disk === null ? null : isBinaryPath(c.path) ? c.disk : digest(c.disk),
      })),
    });
  }
  async checkBatch(
    current: HostedRevision,
    batch: ProjectWriteBatch,
  ): Promise<Omit<ProjectWriteResultMessage, "type" | "request_id">> {
    const files = { ...current.state.files };
    const touched = new Set<string>();
    const conflicts: { path: string; disk: string | null }[] = [];
    const check = async (path: string, base: string | null) => {
      if ((files[path]?.hash ?? null) !== base)
        conflicts.push({
          path,
          disk: files[path]
            ? files[path]!.binary
              ? files[path]!.hash
              : await readFile(filePath(current, path), "utf8")
            : null,
        });
    };
    try {
      if (batch.operationId !== undefined && !logicalId(batch.operationId))
        throw new Error("invalid_path");
      for (const r of batch.renames ?? []) {
        if (
          !publicPath(r.from) ||
          !publicPath(r.to) ||
          r.from === r.to ||
          touched.has(r.from) ||
          touched.has(r.to)
        )
          throw new Error("invalid_path");
        if (isBinaryPath(r.from) !== isBinaryPath(r.to)) throw new Error("invalid_path");
        touched.add(r.from);
        touched.add(r.to);
        await check(r.from, r.base_hash);
        if (files[r.to]) conflicts.push({ path: r.to, disk: files[r.to]!.hash });
        if (files[r.from]) {
          files[r.to] = files[r.from]!;
          delete files[r.from];
        }
      }
      const writes = [
        ...batch.files.map((f) => ({
          path: f.path,
          content: Buffer.from(f.content),
          base: f.base_hash,
          binary: false,
        })),
        ...(batch.deletes ?? []).map((f) => ({
          path: f.path,
          content: null,
          base: f.base_hash,
          binary: false,
        })),
        ...(batch.binaries ?? []).map((f) => ({
          path: f.path,
          content: f.content,
          base: f.baseHash,
          binary: true,
        })),
      ];
      const seen = new Set<string>();
      for (const f of writes) {
        if (
          !publicPath(f.path) ||
          seen.has(f.path) ||
          (batch.renames ?? []).some((r) => r.from === f.path)
        )
          throw new Error("invalid_path");
        seen.add(f.path);
        if (f.content !== null && !isBinaryPath(f.path))
          new TextDecoder("utf-8", { fatal: true }).decode(f.content);
        // A write at a renamed destination compares against the staged source.
        if ((files[f.path]?.hash ?? null) !== f.base) {
          const source = (batch.renames ?? []).find((r) => r.to === f.path)?.from ?? f.path;
          const entry = current.state.files[source];
          conflicts.push({
            path: f.path,
            disk: entry
              ? entry.binary
                ? entry.hash
                : await readFile(filePath(current, source), "utf8")
              : null,
          });
        }
        if (f.content === null) delete files[f.path];
        else
          files[f.path] = {
            hash: digest(f.content),
            size: f.content.length,
            binary: isBinaryPath(f.path),
          };
      }
      assertTreePaths(Object.keys(files));
      // A directory-to-file transformation is deliberately a separate edit;
      // reject it before staging rather than relying on platform rename errors.
      for (const before of Object.keys(current.state.files))
        for (const after of Object.keys(files))
          if (
            before !== after &&
            (before.startsWith(`${after}/`) || after.startsWith(`${before}/`))
          )
            throw new Error("invalid_path");
    } catch {
      return { ok: false, error: "invalid_path" };
    }
    return conflicts.length
      ? {
          ok: false,
          error: "conflict",
          conflicts,
          disk_files: Object.keys(current.state.files),
        }
      : { ok: true };
  }
  async applyBatch(next: HostedRevision, batch: ProjectWriteBatch) {
    for (const r of batch.renames ?? []) {
      await mkdir(dirname(filePath(next, r.to)), { recursive: true });
      await rename(filePath(next, r.from), filePath(next, r.to));
      next.state.files[r.to] = next.state.files[r.from]!;
      delete next.state.files[r.from];
      if (next.state.history[r.from]) {
        next.state.history[r.to] = next.state.history[r.from]!;
        delete next.state.history[r.from];
      }
    }
    const writes = [
      ...batch.files.map((f) => ({
        path: f.path,
        content: Buffer.from(f.content),
        binary: false,
      })),
      ...(batch.deletes ?? []).map((f) => ({
        path: f.path,
        content: null,
        binary: false,
      })),
      ...(batch.binaries ?? []).map((f) => ({
        path: f.path,
        content: f.content,
        binary: true,
      })),
    ];
    for (const f of writes) {
      const before = next.state.files[f.path];
      if (before) {
        const name = randomUUID();
        const archive = join(next.directory, next.state.folderName, ".artisan", "history", name);
        await mkdir(dirname(archive), { recursive: true });
        await rename(filePath(next, f.path), archive);
        next.state.history[f.path] ??= [];
        next.state.history[f.path].unshift({
          at: Date.now(),
          file: name,
          binary: before.binary,
        });
      }
      if (f.content === null) delete next.state.files[f.path];
      else {
        await durableWrite(filePath(next, f.path), f.content);
        next.state.files[f.path] = {
          hash: digest(f.content),
          size: f.content.length,
          binary: isBinaryPath(f.path),
        };
      }
    }
  }
}

class HostedDraftStore implements DraftStore {
  constructor(
    private readonly storage: HostedProjectStorage,
    private readonly owner: string,
  ) {}
  private async envelope(revision: HostedRevision, id: string): Promise<StoredDraft | undefined> {
    if (!logicalId(id) || !revision.state.drafts.includes(id)) return undefined;
    const draft = JSON.parse(await readFile(draftPath(revision, id), "utf8")) as StoredDraft;
    if (draft.schema !== "artisan-draft/v1" || draft.id !== id || draft.ownerId !== this.owner)
      return undefined;
    return draft;
  }
  private async run(
    action: string,
    id: string | undefined,
    operationId: string | undefined,
    input: unknown,
    fn: (revision: HostedRevision) => Promise<DraftResult>,
  ): Promise<DraftOutcome> {
    const fs = this.storage.filesystem;
    return fs.locked(async () => {
      const current = await fs.current();
      if (current.state.deleted || current.state.folderName !== this.storage.options.folderName)
        return result(fail("not_found"));
      if (
        (id !== undefined && !logicalId(id)) ||
        (operationId !== undefined && !logicalId(operationId))
      )
        return result(fail("invalid_input"));
      const fingerprint = digest(JSON.stringify([action, id, input]));
      const key = operationId ? digest(`draft:${this.owner}:${operationId}`) : undefined;
      if (key) {
        const prior = current.state.receipts[key];
        if (prior)
          return result(
            prior.fingerprint !== fingerprint
              ? fail("operation_mismatch")
              : prior.result
                ? (prior.result as DraftResult)
                : fail("operation_expired"),
          );
      }
      if (!key) return result(await fn(current));
      const answer = await fs.commit(current, async (next) => {
        const answer = await fn(next);
        next.state.receipts[key] = {
          fingerprint,
          at: Date.now(),
          ownerId: this.owner,
          result: answer,
        };
        return answer;
      });
      await fs.collect();
      return result(answer);
    });
  }
  list() {
    return this.run("list", undefined, undefined, null, async (r) => {
      const drafts = [];
      for (const id of r.state.drafts) {
        const draft = await this.envelope(r, id);
        if (draft?.status === "active") drafts.push(draft);
      }
      return {
        ok: true,
        drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    });
  }
  read(id: string) {
    return this.run("read", id, undefined, null, async (r) => {
      const draft = await this.envelope(r, id);
      return draft ? { ok: true, draft } : fail("not_found");
    });
  }
  create(id: string, operationId: string, body: DraftBody) {
    return this.run("create", id, operationId, body, async (r) => {
      if (!validDraftBody(body)) return fail("invalid_input");
      if (r.state.drafts.includes(id)) return fail("draft_exists");
      // A reference may reuse only this owner's existing private blob or current public bytes.
      const blobError = await this.ensureBlobs(r, id, body);
      if (blobError) return fail(blobError);
      const now = new Date().toISOString();
      const draft: StoredDraft = {
        schema: "artisan-draft/v1",
        id,
        ownerId: this.owner,
        name: body.name,
        revision: 1,
        status: "active",
        snapshot: body.snapshot,
        createdAt: now,
        updatedAt: now,
        updatedBy: this.owner,
        source: "editor",
      };
      await durableWrite(draftPath(r, id), JSON.stringify(draft));
      r.state.drafts.push(id);
      return { ok: true, draft };
    });
  }
  private mutate(
    action: "update" | "discard" | "publish",
    id: string,
    revision: number,
    operationId: string,
    body?: DraftBody,
  ) {
    return this.run(action, id, operationId, { revision, body }, async (r) => {
      const draft = await this.envelope(r, id);
      if (!draft) return fail("not_found");
      if (draft.revision !== revision || draft.status !== "active")
        return { ok: false, error: "draft_conflict", draft };
      if (body && !validDraftBody(body)) return fail("invalid_input");
      if (body) {
        const error = await this.ensureBlobs(r, id, body);
        if (error) return fail(error);
      }
      let wrote: number | undefined;
      if (action === "publish") {
        const snapshot = draft.snapshot;
        const plan = await applyRenames(
          await planWrite(snapshot.baseline, snapshot.tree),
          snapshot.renames ?? [],
          snapshot.baseline,
        );
        const binaries: BinaryWrite[] = [];
        const base = snapshot.binaryBaseline ?? {};
        const tree = snapshot.binaryTree ?? {};
        for (const path of new Set([...Object.keys(base), ...Object.keys(tree)])) {
          if (base[path]?.hash === tree[path]?.hash) continue;
          let content: Uint8Array | null = null;
          if (tree[path]) {
            try {
              content = new Uint8Array(await readFile(blobPath(r, id, tree[path]!.hash)));
            } catch {
              return fail("missing_blob");
            }
            if (content.length !== tree[path]!.size || digest(content) !== tree[path]!.hash)
              return fail("missing_blob");
          }
          binaries.push({ path, content, baseHash: base[path]?.hash ?? null });
        }
        const batch = { ...plan, binaries };
        const checked = await this.storage.checkBatch(r, batch);
        if (!checked.ok) return checked;
        await this.storage.applyBatch(r, batch);
        wrote = plan.files.length + plan.deletes.length + plan.renames.length + binaries.length;
      }
      const next: StoredDraft = {
        ...draft,
        ...body,
        status: action === "update" ? "active" : action === "discard" ? "discarded" : "published",
        revision: revision + 1,
        updatedBy: this.owner,
        updatedAt: new Date().toISOString(),
      };
      await durableWrite(draftPath(r, id), JSON.stringify(next));
      return {
        ok: true,
        draft: next,
        ...(wrote === undefined ? {} : { wrote }),
      };
    });
  }
  update(id: string, revision: number, operationId: string, body: DraftBody) {
    return this.mutate("update", id, revision, operationId, body);
  }
  discard(id: string, revision: number, operationId: string) {
    return this.mutate("discard", id, revision, operationId);
  }
  publish(id: string, revision: number, operationId: string) {
    return this.mutate("publish", id, revision, operationId);
  }
  writeBlob(
    id: string,
    revision: number,
    operationId: string,
    hash: string,
    contentBase64: string,
  ) {
    return this.run("write_blob", id, operationId, { revision, hash, contentBase64 }, async (r) => {
      const draft = await this.envelope(r, id);
      if (!draft) return fail("not_found");
      if (draft.revision !== revision || draft.status !== "active")
        return { ok: false, error: "draft_conflict", draft };
      const bytes = Buffer.from(contentBase64, "base64");
      if (
        !/^[a-f0-9]{64}$/.test(hash) ||
        digest(bytes) !== hash ||
        bytes.toString("base64") !== contentBase64 ||
        bytes.length > 20 * 1024 * 1024
      )
        return fail("invalid_blob");
      await durableWrite(blobPath(r, id, hash), bytes);
      return { ok: true, draft };
    });
  }
  readBlob(id: string, hash: string) {
    return this.run("read_blob", id, undefined, hash, async (r) => {
      if (!/^[a-f0-9]{64}$/.test(hash) || !(await this.envelope(r, id))) return fail("not_found");
      try {
        const content = await readFile(blobPath(r, id, hash));
        if (digest(content) !== hash) return fail("invalid_blob");
        return { ok: true, content_base64: content.toString("base64") };
      } catch {
        return fail("not_found");
      }
    });
  }
  private async ensureBlobs(
    r: HostedRevision,
    id: string,
    body: DraftBody,
  ): Promise<string | undefined> {
    for (const [path, ref] of Object.entries(body.snapshot.binaryTree ?? {})) {
      if (!publicPath(path)) return "invalid_path";
      let bytes: Buffer | undefined;
      try {
        bytes = await readFile(blobPath(r, id, ref.hash));
      } catch {}
      if (!bytes)
        for (const otherId of r.state.drafts) {
          if (!(await this.envelope(r, otherId))) continue;
          try {
            bytes = await readFile(blobPath(r, otherId, ref.hash));
            break;
          } catch {}
        }
      if (!bytes && r.state.files[path]?.hash === ref.hash)
        bytes = await readFile(filePath(r, path));
      if (!bytes || bytes.length !== ref.size || digest(bytes) !== ref.hash) return "missing_blob";
      await durableWrite(blobPath(r, id, ref.hash), bytes);
    }
    return undefined;
  }
}

export function hostedStorageOptions(project: Project, ownerId: string): HostedStorageOptions {
  if (project.storageKind !== "hosted" || !project.hostedRootId || !project.externalId)
    throw new Error("invalid_location");
  return {
    rootId: project.hostedRootId,
    folderName: project.externalId,
    projectId: project.id,
    ownerId,
  };
}
