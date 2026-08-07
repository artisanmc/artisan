/**
 * Scope provides identifier lookup and PAPI resolution for the
 * evaluator. Identifier bag is a flat object — pre-flattening menu
 * inputs + iteration alias + meta-iter is the caller's responsibility
 * (cf. evaluator + template renderer integration).
 */

export interface ScopeOptions {
  /** Resolves a PAPI placeholder name (without %) to a string. */
  papi?: (name: string) => string;
  /** Wall clock in epoch millis — injected so `until()` is testable and pinnable. */
  now?: () => number;
  /** Translation lookup, for the `artisan.*` presentation keys. */
  translate?: (key: string) => string | undefined;
}

export class Scope {
  constructor(
    private readonly bag: Record<string, unknown>,
    private readonly opts: ScopeOptions = {},
    private readonly parent?: Scope,
  ) {}

  /** Is the name bound anywhere in the chain? Distinct from being bound to undefined. */
  has(name: string): boolean {
    if (name in this.bag) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  lookup(name: string): unknown {
    if (name in this.bag) return this.bag[name];
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }

  papi(name: string): string {
    const fn = this.opts.papi ?? this.parent?.opts.papi;
    return fn ? fn(name) : "";
  }

  now(): number {
    const fn = this.opts.now ?? this.parent?.opts.now;
    return fn ? fn() : Date.now();
  }

  translate(key: string): string | undefined {
    const fn = this.opts.translate ?? this.parent?.opts.translate;
    return fn ? fn(key) : undefined;
  }

  child(extra: Record<string, unknown>, opts?: ScopeOptions): Scope {
    return new Scope(extra, opts ?? {}, this);
  }
}
