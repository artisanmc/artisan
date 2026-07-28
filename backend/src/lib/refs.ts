import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index";
import { networks, projects } from "../db/schema";
import { requireMember } from "./membershipGuard";

/**
 * Les URLs de l'éditeur portent des **slugs** (network, serveur, project) alors
 * que les identités restent les ids. Ces résolveurs sont le point de passage :
 * toute route adressée depuis une URL doit accepter les deux formes, sinon elle
 * répond 403/404 sur un lien parfaitement valide.
 */

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
export async function resolveNetworkForMember(
	userId: string,
	ref: string,
): Promise<string | null> {
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

/**
 * Project par id ou slug **dans un network donné**. Le slug n'est unique que
 * par *serveur* : s'il désigne plusieurs projects du network (deux serveurs
 * ayant chacun le leur), on ne devine pas — null plutôt que le mauvais project.
 */
export async function resolveProjectInNetwork(
	ref: string,
	networkId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: projects.id, slug: projects.slug })
		.from(projects)
		.where(
			and(
				eq(projects.networkId, networkId),
				or(eq(projects.id, ref), eq(projects.slug, ref)),
				isNull(projects.deletedAt),
			),
		);
	const exact = rows.find((r) => r.id === ref);
	if (exact) return exact.id;
	return rows.length === 1 ? rows[0]!.id : null;
}
