import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { networkTransfers } from "../db/schema";
import { generateEditorToken } from "./auth";

export interface NetworkTransfer {
  token: string;
  networkId: string;
  initiatedByUserId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedByUserId: string | null;
  createdAt: Date;
}

const TTL_HOURS = 24;

export async function createTransfer(networkId: string, userId: string): Promise<NetworkTransfer> {
  const token = generateEditorToken();
  const now = new Date();
  const row: NetworkTransfer = {
    token,
    networkId,
    initiatedByUserId: userId,
    expiresAt: new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000),
    consumedAt: null,
    consumedByUserId: null,
    createdAt: now,
  };
  await db.insert(networkTransfers).values(row);
  return row;
}

export async function getTransfer(token: string): Promise<NetworkTransfer | null> {
  const rows = await db.select().from(networkTransfers).where(eq(networkTransfers.token, token));
  return rows.length > 0 ? rows[0] : null;
}

export async function consumeTransfer(token: string, userId: string): Promise<NetworkTransfer | null> {
  const now = new Date();
  const updated = await db
    .update(networkTransfers)
    .set({ consumedAt: now, consumedByUserId: userId })
    .where(and(eq(networkTransfers.token, token), isNull(networkTransfers.consumedAt)))
    .returning();
  return updated.length > 0 ? updated[0] : null;
}
