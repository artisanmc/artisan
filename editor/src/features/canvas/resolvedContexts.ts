import type { PreviewCallContext } from "./previewCallContexts";

/** `{token}` or `{token.field}` left verbatim for lack of a row to resolve. */
const UNRESOLVED = /\{[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\}/i;

/**
 * Does the context hold up?
 *
 * A link's arguments resolve against the caller's rows. Without data — live
 * source of a disconnected server — there is nothing to iterate and the
 * templates come out raw. Such a context opens no real screen: showing it
 * gives a banner reading "› {cat}" and a choice that changes nothing.
 */
export function isResolvedContext(args: Record<string, unknown>): boolean {
  return Object.values(args).every((v) => typeof v !== "string" || !UNRESOLVED.test(v));
}

/** The only contexts offered for editing. */
export function resolvedContexts(contexts: PreviewCallContext[]): PreviewCallContext[] {
  return contexts.filter((c) => isResolvedContext(c.args));
}
