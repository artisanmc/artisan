import { requestProjectDraft } from "../../ws/hub";
import type { DraftBody, DraftOutcome, DraftStore, StoredDraft } from "./DraftStore";

export interface DraftRequest {
  project_id: string;
  owner_id: string;
  action: "list" | "read" | "create" | "update" | "discard" | "publish" | "write_blob" | "read_blob" | "import" | "list_all" | "purge_owner";
  draft_id?: string;
  operation_id?: string;
  expected_revision?: number;
  name?: string;
  snapshot?: DraftBody["snapshot"];
  draft?: StoredDraft;
  hash?: string;
  content_base64?: string;
}
export type DraftTransport = (serverId: string, request: DraftRequest) => Promise<DraftOutcome>;

export class ServerDraftStore implements DraftStore {
  constructor(private readonly serverId: string, private readonly folder: string, private readonly owner: string, private readonly transport: DraftTransport = requestProjectDraft) {}
  private send(request: Omit<DraftRequest, "project_id" | "owner_id">) {
    return this.transport(this.serverId, { ...request, project_id: this.folder, owner_id: this.owner });
  }
  list() { return this.send({ action: "list" }); }
  read(id: string) { return this.send({ action: "read", draft_id: id }); }
  readBlob(id: string, hash: string) { return this.send({ action: "read_blob", draft_id: id, hash }); }
  create(id: string, operationId: string, body: DraftBody) { return this.send({ action: "create", draft_id: id, operation_id: operationId, name: body.name, snapshot: body.snapshot }); }
  update(id: string, revision: number, operationId: string, body: DraftBody) { return this.send({ action: "update", draft_id: id, expected_revision: revision, operation_id: operationId, name: body.name, snapshot: body.snapshot }); }
  discard(id: string, revision: number, operationId: string) { return this.send({ action: "discard", draft_id: id, expected_revision: revision, operation_id: operationId }); }
  publish(id: string, revision: number, operationId: string) { return this.send({ action: "publish", draft_id: id, expected_revision: revision, operation_id: operationId }); }
  writeBlob(id: string, revision: number, operationId: string, hash: string, contentBase64: string) { return this.send({ action: "write_blob", draft_id: id, expected_revision: revision, operation_id: operationId, hash, content_base64: contentBase64 }); }
}
