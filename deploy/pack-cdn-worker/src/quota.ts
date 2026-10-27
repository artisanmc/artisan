import { DurableObject } from "cloudflare:workers";

/** What one key (a server, an address, everyone) did today, in UTC. */
interface Usage { day: string; requests: number; bytes: number }

export interface Limit { requests: number; bytes: number }

/**
 * A daily quota, one object per key: `server:<id>`, `ip:<address>` and `global`. An object handles
 * one call at a time, so two uploads from one server cannot both pass a limit only one fits under.
 */
export class QuotaObject extends DurableObject {
  /** Counts a request of [bytes] if it fits under [limit] today; false: it does not, and nothing is counted. */
  async charge(bytes: number, limit: Limit): Promise<boolean> {
    const day = today();
    const stored = await this.ctx.storage.get<Usage>("usage");
    const usage = stored?.day === day ? stored : { day, requests: 0, bytes: 0 };
    if (usage.requests + 1 > limit.requests || usage.bytes + bytes > limit.bytes) return false;
    usage.requests += 1;
    usage.bytes += bytes;
    await this.ctx.storage.put("usage", usage);
    return true;
  }

  async usage(): Promise<Usage> {
    const stored = await this.ctx.storage.get<Usage>("usage");
    return stored?.day === today() ? stored : { day: today(), requests: 0, bytes: 0 };
  }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Seconds until the quotas reset, at midnight UTC: the `Retry-After` of a refusal. */
export function secondsToReset(now = Date.now()): number {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now) / 1000));
}
