import { requestProjectRead, requestProjectWrite, requestAssetRead, requestAssetWrite, requestProjectHistory, requestProjectRename, supportsProjectRename } from "../../ws/hub";
import { ProjectRenameError } from "../projectRename";
import { renameStoredProject } from "./projectLifecycle";
import { forgetProjectTree, readProjectTree } from "../projectTreeReads";
import { getCachedAsset, putCachedAsset } from "../assetCache";
import { mirrorSupported } from "../snapshotMirror";
import { createHash } from "node:crypto";
import type { BinaryReadResult } from "./ProjectStorage";
import type { BinaryWrite, ProjectLocation, ProjectStorage, ProjectWriteBatch, StorageOutcome } from "./ProjectStorage";
import type { DraftStore } from "./DraftStore";

interface ServerTransport {
  read: typeof requestProjectRead;
  write: typeof requestProjectWrite;
  readBinary: typeof requestAssetRead;
  writeBinaries: typeof requestAssetWrite;
  history: typeof requestProjectHistory;
  invalidate: typeof forgetProjectTree;
  readAssets: typeof readProjectTree;
}

const assetReads = new Map<string, Promise<StorageOutcome<BinaryReadResult>>>();

function withoutCorrelation<T extends { type: string; request_id: string }>(outcome: { kind: "result"; result: T } | { kind: "offline" } | { kind: "timeout" }): StorageOutcome<T> {
  if (outcome.kind !== "result") return outcome;
  const { type: _type, request_id: _requestId, ...result } = outcome.result;
  return { ...outcome, result };
}

export class ServerProjectStorage implements ProjectStorage {
  private draftStore?: DraftStore;
  get drafts(): DraftStore { if (!this.draftStore) throw new Error("draft_principal_required"); return this.draftStore; }
  bindDraftStore(store: DraftStore) { this.draftStore = store; }
  get capabilities() { return Object.freeze({ liveData: true, captureInGame: true, preview: true, canRename: this.identity?.kind === "folder" && supportsProjectRename(this.location.serverKeyId) }); }
  private readonly transport: ServerTransport;
  constructor(private readonly location: Extract<ProjectLocation, { kind: "server" }>, transport: Partial<ServerTransport> = {}, private readonly identity?: { id: string; kind: string }) {
    this.transport = { read: requestProjectRead, write: requestProjectWrite, readBinary: (server, request) => requestAssetRead(server, request, 30_000), writeBinaries: requestAssetWrite, history: requestProjectHistory, invalidate: forgetProjectTree, readAssets: readProjectTree, ...transport };
  }
  async rename(operationId: string, targetId: string) {
    if (!this.identity || this.identity.kind === "addon") throw new ProjectRenameError("addon_immutable");
    return renameStoredProject(this.identity.id,operationId,targetId,{canRename:this.capabilities.canRename,apply:async sourceId=> {
      const outcome=await requestProjectRename(this.location.serverKeyId,{operationId,projectId:sourceId,targetId});
      return outcome.kind==="result"?outcome.result:{ok:false,error:"rename_pending"};
    }});
  }
  async read(ifHash: string | null = null) {
    if (!mirrorSupported(this.location.serverKeyId)) {
      return withoutCorrelation(await this.transport.read(this.location.serverKeyId, { projectId: this.location.folderName, ifHash }));
    }
    // Le miroir du Snapshot sert l'arbre ; `if_hash` se tranche ici, sans le plugin.
    const outcome = withoutCorrelation(await this.transport.readAssets(this.location.serverKeyId, this.location.folderName));
    if (outcome.kind === "result" && outcome.result.ok && ifHash && outcome.result.hash === ifHash) {
      return { kind: "result" as const, result: { ok: true, unchanged: true, hash: ifHash } };
    }
    return outcome;
  }
  async readAssetTree() {
    return withoutCorrelation(await this.transport.readAssets(this.location.serverKeyId, this.location.folderName));
  }
  async readAssetBinary(path: string, hash: string): Promise<StorageOutcome<BinaryReadResult>> {
    const key = { serverKeyId: this.location.serverKeyId, projectId: this.location.folderName, path, hash };
    const id = JSON.stringify(key);
    const pending = assetReads.get(id);
    if (pending) return pending;
    const load = (async () => {
      const cached = await getCachedAsset(key);
      if (cached) return { kind: "result" as const, result: { ok: true, content: cached, hash } };
      const outcome = await this.readBinary(path);
      if (outcome.kind === "result" && outcome.result.ok && outcome.result.content && createHash("sha256").update(outcome.result.content).digest("hex") === hash) {
        await putCachedAsset(key, outcome.result.content);
      }
      return outcome;
    })();
    assetReads.set(id, load);
    try { return await load; }
    finally { if (assetReads.get(id) === load) assetReads.delete(id); }
  }
  async write(batch: ProjectWriteBatch) {
    this.invalidate();
    try {
      const { binaries, ...text } = batch;
      return withoutCorrelation(await this.transport.write(this.location.serverKeyId, { ...text, projectId: this.location.folderName, ...(binaries ? { binaries: binaries.map((b) => ({ path: b.path, base_hash: b.baseHash, content_base64: b.content === null ? null : Buffer.from(b.content).toString("base64") })) } : {}) }));
    } finally {
      this.invalidate();
    }
  }
  async readBinary(path: string) {
    const outcome = await this.transport.readBinary(this.location.serverKeyId, { projectId: this.location.folderName, path });
    if (outcome.kind !== "result") return outcome;
    const { content_base64, type: _type, request_id: _requestId, ...result } = outcome.result;
    return { kind: "result" as const, result: { ...result, ...(content_base64 === undefined ? {} : { content: new Uint8Array(Buffer.from(content_base64, "base64")) }) } };
  }
  async writeBinaries(files: BinaryWrite[]) {
    this.invalidate();
    try {
      return withoutCorrelation(await this.transport.writeBinaries(this.location.serverKeyId, {
        projectId: this.location.folderName,
        files: files.map(({ path, content, baseHash }) => ({ path, contentBase64: content === null ? null : Buffer.from(content).toString("base64"), baseHash })),
      }));
    } finally {
      this.invalidate();
    }
  }
  async history(path: string) {
    return withoutCorrelation(await this.transport.history(this.location.serverKeyId, { projectId: this.location.folderName, path }));
  }
  private invalidate() {
    this.transport.invalidate(this.location.serverKeyId, this.location.folderName);
  }
}
