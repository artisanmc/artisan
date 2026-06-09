import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { appSettings } from "../db/schema";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (rows.length === 0) return null;
  try { return JSON.parse(rows[0].value) as T; } catch { return null; }
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  const v = JSON.stringify(value);
  const now = new Date();
  await db.insert(appSettings)
    .values({ key, value: v, updatedAt: now, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: now, updatedBy } });
}
