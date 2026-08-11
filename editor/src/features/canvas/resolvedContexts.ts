import type { PreviewCallContext } from "./previewCallContexts";

/** `{token}` ou `{token.champ}` resté tel quel faute de ligne à résoudre. */
const UNRESOLVED = /\{[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\}/i;

/**
 * Le contexte tient-il debout ?
 *
 * Les arguments d'un lien se résolvent contre les lignes de l'appelant. Sans
 * données — source live d'un serveur non connecté — il n'y a rien à itérer et
 * les templates ressortent bruts. Un tel contexte n'ouvre aucun écran réel :
 * l'afficher donne un bandeau qui dit « › {cat} » et un choix qui ne change rien.
 */
export function isResolvedContext(args: Record<string, unknown>): boolean {
  return Object.values(args).every((v) => typeof v !== "string" || !UNRESOLVED.test(v));
}

/** Les seuls contextes qu'on propose à l'édition. */
export function resolvedContexts(contexts: PreviewCallContext[]): PreviewCallContext[] {
  return contexts.filter((c) => isResolvedContext(c.args));
}
