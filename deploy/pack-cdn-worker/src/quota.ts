import { DurableObject } from "cloudflare:workers";

/** What one key (a server, an address, everyone) did today, in UTC; [alerted]: the alerts already sent today. */
interface Usage { day: string; requests: number; bytes: number; alerted?: Alert[] }

export interface Limit {
  requests: number;
  bytes: number;
  /** Bytes past which today's usage is worth an alert, once a day; none: no alert. */
  alertBytes?: number;
}

/** `half`: [Limit.alertBytes] crossed by this request; `full`: this request was refused at the limit. */
export type Alert = "half" | "full";

export interface Charge { ok: boolean; bytes: number; alert: Alert | null }

/**
 * A daily quota, one object per key: `server:<id>`, `ip:<address>` and `global`. An object handles
 * one call at a time, so two uploads from one server cannot both pass a limit only one fits under.
 */
export class QuotaObject extends DurableObject {
  /**
   * Counts a request of [bytes] if it fits under [limit] today; not ok: it does not, and nothing is
   * counted. The first request of the day that crosses [Limit.alertBytes], and the first refused, carry an alert.
   */
  async charge(bytes: number, limit: Limit): Promise<Charge> {
    const day = today();
    const stored = await this.ctx.storage.get<Usage>("usage");
    const usage: Usage = stored?.day === day ? stored : { day, requests: 0, bytes: 0 };
    const alerted = usage.alerted ?? [];
    const ok = usage.requests + 1 <= limit.requests && usage.bytes + bytes <= limit.bytes;
    let alert: Alert | null = null;
    if (ok) {
      const threshold = limit.alertBytes;
      if (threshold !== undefined && usage.bytes < threshold && usage.bytes + bytes >= threshold && !alerted.includes("half")) alert = "half";
      usage.requests += 1;
      usage.bytes += bytes;
    } else if (limit.alertBytes !== undefined && !alerted.includes("full")) {
      alert = "full";
    }
    if (alert) usage.alerted = [...alerted, alert];
    if (ok || alert) await this.ctx.storage.put("usage", usage);
    return { ok, bytes: usage.bytes, alert };
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
