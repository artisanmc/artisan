import { db } from "../db/index";
import { userSessions } from "../db/schema";

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

export interface UserSessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string): Promise<UserSessionRow> {
  const now = new Date();
  const row = {
    id: generateSessionId(),
    userId,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS),
  };
  await db.insert(userSessions).values(row);
  return row;
}
