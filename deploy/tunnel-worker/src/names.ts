import { DurableObject } from "cloudflare:workers";
import { config, publicUrl, type Config, type Env } from "./config";
import { BLOCKED_WORDS, validName, type NameResult } from "./protocol";

/** The names file of the Kotlin tunnel server (NameRegistry.Stored), for `POST /admin/import`. */
export interface Stored {
  names?: Record<string, { id: string; claimedAt: string; seenAt: string }>;
  banned?: string[];
}

const DAY = 86_400_000;
/** Names one id takes per UTC day, and one plugin address for all its ids (NameRegistry). */
const CHANGES_PER_DAY = 3;
const CLAIMS_PER_ADDRESS_PER_DAY = 10;

/**
 * The names addresses took (ADR `editor-tunnel`, decision 8), one object for all: `survie.<domain>` for
 * the tunnel `<id>`, one name per id, first come first served. Browsers never ask it: the Worker reads
 * `name:<name>` in KV, which this object keeps up to date.
 */
export class NamesObject extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly cfg: Config;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.cfg = config(env);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, claimed_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS banned (name TEXT PRIMARY KEY)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS changes (key TEXT PRIMARY KEY, day INTEGER NOT NULL, count INTEGER NOT NULL)`);
  }

  nameOf(id: string): string | null {
    const row = this.sql.exec<{ name: string }>(`SELECT name FROM names WHERE id = ?`, id).toArray()[0];
    return row?.name ?? null;
  }

  private idOf(name: string): string | null {
    const row = this.sql.exec<{ id: string }>(`SELECT id FROM names WHERE name = ?`, name).toArray()[0];
    return row?.id ?? null;
  }

  private isReserved(name: string): boolean {
    if (this.cfg.reserved.has(name) || BLOCKED_WORDS.some((word) => name.includes(word))) return true;
    return this.sql.exec(`SELECT 1 FROM banned WHERE name = ?`, name).toArray().length > 0;
  }

  private used(key: string): number {
    const today = Math.floor(Date.now() / DAY);
    const row = this.sql.exec<{ day: number; count: number }>(`SELECT day, count FROM changes WHERE key = ?`, key).toArray()[0];
    return row && row.day === today ? row.count : 0;
  }

  private count(key: string): void {
    const today = Math.floor(Date.now() / DAY);
    this.sql.exec(`INSERT INTO changes (key, day, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN day = excluded.day THEN count + 1 ELSE 1 END, day = excluded.day`, key, today);
  }

  private refusal(id: string, name: string, address: string): string | null {
    if (!validName(name)) return "invalid";
    if (this.isReserved(name)) return "reserved";
    const holder = this.idOf(name);
    if (holder !== null && holder !== id) return "taken";
    if (holder !== null) return null;
    if (this.used(id) >= CHANGES_PER_DAY) return "too_many";
    if (address && this.used(`address:${address}`) >= CLAIMS_PER_ADDRESS_PER_DAY) return "too_many";
    return null;
  }

  /** A plugin asks for [name] (empty: give it back), or only whether it could ([check]). */
  async request(id: string, rawName: string, check: boolean, address: string): Promise<{ result: NameResult; changed: boolean }> {
    const name = rawName.trim().toLowerCase();
    if (check) {
      const error = this.refusal(id, name, address);
      return { result: error ? { ok: false, name, error } : { ok: true, name, url: publicUrl(name, this.cfg) }, changed: false };
    }
    if (name === "") {
      const previous = this.nameOf(id);
      if (previous) {
        this.sql.exec(`DELETE FROM names WHERE name = ?`, previous);
        await this.env.KV.delete(`name:${previous}`);
      }
      return { result: { ok: true, name: null, url: publicUrl(id, this.cfg) }, changed: previous !== null };
    }
    const error = this.refusal(id, name, address);
    if (error) return { result: { ok: false, name, error }, changed: false };
    const previous = this.nameOf(id);
    if (previous === name) return { result: { ok: true, name, url: publicUrl(name, this.cfg) }, changed: false };
    const now = Date.now();
    if (previous) {
      this.sql.exec(`DELETE FROM names WHERE name = ?`, previous);
      await this.env.KV.delete(`name:${previous}`);
    }
    this.sql.exec(`INSERT INTO names (name, id, claimed_at, seen_at) VALUES (?, ?, ?, ?)`, name, id, now, now);
    await this.env.KV.put(`name:${name}`, id);
    this.count(id);
    if (address) this.count(`address:${address}`);
    this.notify(name, id, previous, address);
    return { result: { ok: true, name, url: publicUrl(name, this.cfg) }, changed: true };
  }

  /** [id] is connected: its name stays. Names nobody connected under for the expiry go back. */
  async seen(id: string): Promise<void> {
    const now = Date.now();
    this.sql.exec(`UPDATE names SET seen_at = ? WHERE id = ? AND seen_at < ?`, now, id, now - 3_600_000);
    const expired = this.sql.exec<{ name: string }>(`SELECT name FROM names WHERE id != ? AND seen_at < ?`,
      id, now - this.cfg.nameExpiryDays * DAY).toArray();
    for (const { name } of expired) {
      this.sql.exec(`DELETE FROM names WHERE name = ?`, name);
      await this.env.KV.delete(`name:${name}`);
    }
  }

  list(): { names: Record<string, { id: string; claimedAt: string; seenAt: string }>; banned: string[] } {
    const names: Record<string, { id: string; claimedAt: string; seenAt: string }> = {};
    for (const row of this.sql.exec<{ name: string; id: string; claimed_at: number; seen_at: number }>(`SELECT * FROM names ORDER BY name`)) {
      names[row.name] = { id: row.id, claimedAt: new Date(row.claimed_at).toISOString(), seenAt: new Date(row.seen_at).toISOString() };
    }
    const banned = this.sql.exec<{ name: string }>(`SELECT name FROM banned ORDER BY name`).toArray().map((r) => r.name);
    return { names, banned };
  }

  /** Frees [name] (admin); [ban] also keeps anyone from taking it again. The id that held it, if any. */
  async revoke(name: string, ban: boolean): Promise<string | null> {
    const held = this.idOf(name);
    if (held !== null) {
      this.sql.exec(`DELETE FROM names WHERE name = ?`, name);
      await this.env.KV.delete(`name:${name}`);
    }
    if (ban) this.sql.exec(`INSERT OR IGNORE INTO banned (name) VALUES (?)`, name);
    return held;
  }

  unban(name: string): boolean {
    return this.sql.exec(`DELETE FROM banned WHERE name = ?`, name).rowsWritten > 0;
  }

  /** Takes over the Kotlin tunnel server's `names.json`. Names already here are kept. */
  async importStored(stored: Stored): Promise<{ imported: number; banned: number }> {
    let imported = 0;
    for (const [name, entry] of Object.entries(stored.names ?? {})) {
      if (this.idOf(name) !== null || this.nameOf(entry.id) !== null) continue;
      this.sql.exec(`INSERT INTO names (name, id, claimed_at, seen_at) VALUES (?, ?, ?, ?)`,
        name, entry.id, Date.parse(entry.claimedAt) || Date.now(), Date.parse(entry.seenAt) || Date.now());
      await this.env.KV.put(`name:${name}`, entry.id);
      imported++;
    }
    for (const name of stored.banned ?? []) this.sql.exec(`INSERT OR IGNORE INTO banned (name) VALUES (?)`, name);
    return { imported, banned: (stored.banned ?? []).length };
  }

  /** The Discord webhook told of each name taken (NamesWebhook): no mentions, never retried. */
  private notify(name: string, id: string, previous: string | null, from: string): void {
    const url = this.env.TUNNEL_NAMES_WEBHOOK;
    if (!url) return;
    let content = `Address taken: **${name}** → <${publicUrl(name, this.cfg)}>\ntunnel \`${id}\``;
    if (previous) content += `, was \`${previous}\``;
    content += `, from \`${from}\`\nRevoke: \`DELETE /admin/names/${name}\` (\`?ban=1\` keeps it from being taken again)`;
    this.ctx.waitUntil(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    }).then((r) => { if (!r.ok) console.warn(`Names webhook failed: HTTP ${r.status}`); },
      (e) => console.warn(`Names webhook failed: ${e}`)));
  }
}
