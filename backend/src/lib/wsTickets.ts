import { randomBytes } from "node:crypto";

const TTL_MS = 30_000;
const tickets = new Map<string, { userId: string; expiresAt: number }>();

export function issueTicket(userId: string, nowMs: number = Date.now()): string {
  const ticket = "wst_" + randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: nowMs + TTL_MS });
  return ticket;
}

export function redeemTicket(ticket: string, nowMs: number = Date.now()): { userId: string } | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket); // one-shot, même si expiré
  if (entry.expiresAt < nowMs) return null;
  return { userId: entry.userId };
}

export function __resetTicketsForTests(): void {
  tickets.clear();
}
