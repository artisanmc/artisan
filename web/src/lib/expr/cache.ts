import type { AstNode } from "./ast";
import { parse } from "./parser";

/**
 * LRU-ish cache for parsed expressions. Key = `${packId}|${version}|${expr}`.
 *
 * Implementation note: we use insertion-order Map iteration to evict the
 * oldest key when at capacity. On read, we re-insert (delete+set) to mark
 * the entry as most-recently-used. Simple and JS-stdlib only — no Caffeine.
 */
export class AstCache {
  private readonly map = new Map<string, AstNode>();
  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  get(packId: string, version: number, expr: string): AstNode {
    const key = `${packId}|${version}|${expr}`;
    const cached = this.map.get(key);
    if (cached) {
      this.map.delete(key);
      this.map.set(key, cached);
      return cached;
    }
    const ast = parse(expr);
    this.map.set(key, ast);
    if (this.map.size > this.capacity) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    return ast;
  }
}
