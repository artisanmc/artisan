import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "../../db";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const context = new AsyncLocalStorage<Transaction>();
/** Nested filesystem/lifecycle locks must share a connection, even when the pool is saturated. */
export const storageDatabase = () => context.getStore() ?? db;
export function storageTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const existing = context.getStore();
  return existing ? fn(existing) : db.transaction((tx) => context.run(tx, () => fn(tx)));
}
