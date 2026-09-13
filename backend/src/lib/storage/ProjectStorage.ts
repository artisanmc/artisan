import type { AssetReadResultMessage, AssetWriteResultMessage, ProjectReadResultMessage, ProjectWriteResultMessage, ProjectHistoryResultMessage } from "../../protocol";
import type { DraftStore } from "./DraftStore";

export type ProjectLocation =
  | { kind: "server"; serverKeyId: string; folderName: string }
  | { kind: "hosted"; rootId: string; folderName: string };

export interface ProjectCapabilities {
  readonly canCopyToServer?: boolean;
  readonly canRename: boolean;
  readonly liveData: boolean;
  readonly captureInGame: boolean;
  readonly preview: boolean;
}

// Correlation and message type belong to the transport, not storage callers.
export type StorageOutcome<T> =
  | { kind: "result"; result: Omit<T, "type" | "request_id"> }
  | { kind: "offline" }
  | { kind: "timeout" };
export interface ProjectWriteBatch {
  operationId?: string;
  binaries?: BinaryWrite[];
  files: { path: string; content: string; base_hash: string | null }[];
  deletes?: { path: string; base_hash: string | null }[];
  renames?: { from: string; to: string; base_hash: string }[];
  create?: boolean;
}
export interface BinaryWrite {
  path: string;
  content: Uint8Array | null;
  baseHash: string | null;
}
export type BinaryReadResult = Omit<AssetReadResultMessage, "type" | "request_id" | "content_base64"> & { content?: Uint8Array };

/** A bound, authorized project. Callers never choose a backend on each operation. */
export interface ProjectStorage {
  readonly drafts: DraftStore;
  rename(operationId: string, targetId: string): Promise<{ ok: true; operationId: string; projectId: string; diskId: string } | { ok: false; operationId: string; error: string }>;
  readonly capabilities: ProjectCapabilities;
  read(ifHash?: string | null): Promise<StorageOutcome<ProjectReadResultMessage>>;
  write(batch: ProjectWriteBatch): Promise<StorageOutcome<ProjectWriteResultMessage>>;
  readBinary(path: string): Promise<StorageOutcome<BinaryReadResult>>;
  writeBinaries(files: BinaryWrite[]): Promise<StorageOutcome<AssetWriteResultMessage>>;
  history(path: string): Promise<StorageOutcome<ProjectHistoryResultMessage>>;
}
