import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { projectDraftOperations } from "../../db/schema";
import type { DraftBody, DraftOutcome, DraftStore } from "./DraftStore";
import { draftOperationFingerprint } from "./LegacyDraftStore";

export async function expireDraftReceipts() {
  await db.update(projectDraftOperations).set({ result: { ok: false, error: "operation_expired" }, expiresAt: null }).where(lte(projectDraftOperations.expiresAt, new Date()));
}

/** Read-only transition receipts; never store results of new server mutations. */
export class ReceiptDraftStore implements DraftStore {
  constructor(private readonly projectId: string, private readonly ownerId: string, private readonly store: DraftStore) {}
  private async replay(action: string, operationId: string, input: unknown, perform: () => Promise<DraftOutcome>): Promise<DraftOutcome> {
    await expireDraftReceipts();
    const [receipt] = await db.select().from(projectDraftOperations).where(and(eq(projectDraftOperations.projectId, this.projectId), eq(projectDraftOperations.ownerId, this.ownerId), eq(projectDraftOperations.operationId, operationId)));
    if (receipt) return { kind: "result", result: receipt.fingerprint === draftOperationFingerprint(action, input) ? receipt.result : { ok: false, error: "operation_mismatch" } };
    return perform();
  }
  list() { return this.store.list(); }
  read(id: string) { return this.store.read(id); }
  readBlob(id: string, hash: string) { return this.store.readBlob(id, hash); }
  create(id: string, operationId: string, body: DraftBody) { return this.replay("create", operationId, { id, ...body }, () => this.store.create(id, operationId, body)); }
  update(id: string, revision: number, operationId: string, body: DraftBody) { return this.replay("update", operationId, { id, revision, body }, () => this.store.update(id, revision, operationId, body)); }
  discard(id: string, revision: number, operationId: string) { return this.replay("discard", operationId, { id, revision, body: undefined }, () => this.store.discard(id, revision, operationId)); }
  publish(id: string, revision: number, operationId: string) { return this.replay("publish", operationId, { id, revision, body: undefined }, () => this.store.publish(id, revision, operationId)); }
  writeBlob(id: string, revision: number, operationId: string, hash: string, bytes: string) { return this.store.writeBlob(id, revision, operationId, hash, bytes); }
}
