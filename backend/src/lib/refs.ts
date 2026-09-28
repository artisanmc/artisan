import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db/index";
import { networks, projects, projectRenames, serverKeys } from "../db/schema";
import { requireMember } from "./membershipGuard";

/** Networks retain slug URLs; projects use scoped folder/module IDs. */

/** Network par id ou slug, sans contrôle d'accès — l'appelant garde le sien. */
export async function resolveNetworkRef(ref: string): Promise<string | null> {
  const rows = await db
    .select({ id: networks.id })
    .from(networks)
    .where(or(eq(networks.id, ref), eq(networks.slug, ref)));
  return rows[0]?.id ?? null;
}

/** Network par id ou slug, puis appartenance. null = inconnu OU non-membre —
 *  les deux se répondent pareil pour ne pas révéler l'existence du network. */
export async function resolveNetworkForMember(userId: string, ref: string): Promise<string | null> {
  const rows = await db
    .select({ id: networks.id })
    .from(networks)
    .where(or(eq(networks.id, ref), eq(networks.slug, ref)));
  const id = rows[0]?.id;
  if (!id) return null;
  try {
    await requireMember(userId, id);
  } catch {
    return null;
  }
  return id;
}

/** Network API references: reject ambiguous project aliases across servers. */
export async function resolveProjectInNetwork(
  ref: string,
  networkId: string,
): Promise<string | null> {
  const exact = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.networkId, networkId), eq(projects.id, ref), isNull(projects.deletedAt)),
    );
  return exact[0]?.id ?? resolveProjectInScope(ref, eq(projects.networkId, networkId));
}

export async function resolveProjectServer(serverRef: string, networkRef?: string | null) {
  const networkId = networkRef ? await resolveNetworkRef(networkRef) : null;
  if (networkRef && !networkId) return null;
  const keys = await db
    .select()
    .from(serverKeys)
    .where(
      and(
        networkId ? eq(serverKeys.networkId, networkId) : undefined,
        or(eq(serverKeys.id, serverRef), eq(serverKeys.slug, serverRef)),
      ),
    );
  const exact = keys.find((key) => key.id === serverRef);
  return exact ?? (keys.length === 1 ? keys[0]! : null);
}

/** Canonical IDs win; legacy references must identify exactly one live anchor. */
export async function resolveProjectInScope(ref: string, scope: SQL) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(scope, isNull(projects.deletedAt)));
  const canonical = rows.filter((p) => (p.externalId ?? p.id) === ref);
  if (canonical.length) return canonical.length === 1 ? canonical[0]!.id : null;
  const renames = await db
    .select()
    .from(projectRenames)
    .where(and(eq(projectRenames.sourceId, ref), eq(projectRenames.status, "complete")));
  const aliases = rows.filter(
    (p) => p.id === ref || p.slug === ref || renames.some((r) => r.projectId === p.id),
  );
  return aliases.length === 1 ? aliases[0]!.id : null;
}

export async function resolveScopedProjectRef(
  ref: string,
  serverRef?: string | null,
  networkRef?: string | null,
) {
  if (serverRef) {
    const server = await resolveProjectServer(serverRef, networkRef);
    return server ? resolveProjectInScope(ref, eq(projects.serverKeyId, server.id)) : null;
  }
  // Tout Project de compte appartient à un serveur (ADR `server-only-projects`) :
  // un Network seul ne désigne aucun Project.
  if (networkRef) return null;
  // Unscoped API callers already hold the immutable internal identity.
  return ref;
}
