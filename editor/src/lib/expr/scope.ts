/**
 * Scope provides identifier lookup and PAPI resolution for the
 * evaluator. Identifier bag is a flat object — pre-flattening menu
 * inputs + iteration alias + meta-iter is the caller's responsibility
 * (cf. evaluator + template renderer integration).
 */

export interface ScopeOptions {
  /** Resolves a PAPI placeholder name (without %) to a string. */
  papi?: (name: string) => string;
}

export class Scope {
  constructor(
    private readonly bag: Record<string, unknown>,
    private readonly opts: ScopeOptions = {},
    private readonly parent?: Scope,
  ) {}

  lookup(name: string): unknown {
    if (name in this.bag) return this.bag[name];
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }

  papi(name: string): string {
    const fn = this.opts.papi ?? this.parent?.opts.papi;
    return fn ? fn(name) : "";
  }

  child(extra: Record<string, unknown>, opts?: ScopeOptions): Scope {
    return new Scope(extra, opts ?? {}, this);
  }
}
