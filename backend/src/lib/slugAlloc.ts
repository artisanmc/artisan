import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks, projects, serverKeys } from "../db/schema";
import { slugify, uniqueSlug } from "./slug";

/**
 * DB-aware slug allocators. Each derives a slug from a name and dedups it
 * against the existing slugs in its uniqueness scope (network = global, server =
 * per network, project = per server key) — mirroring the unique indexes. The
 * index is the ultimate guard against a concurrent-create race.
 */

export async function allocNetworkSlug(name: string): Promise<string> {
	const rows = await db.select({ slug: networks.slug }).from(networks);
	const taken = rows.map((r) => r.slug).filter((s): s is string => !!s);
	return uniqueSlug(slugify(name, "network"), taken);
}

export async function allocServerSlug(
	networkId: string,
	label: string | null,
): Promise<string> {
	const rows = await db
		.select({ slug: serverKeys.slug })
		.from(serverKeys)
		.where(eq(serverKeys.networkId, networkId));
	const taken = rows.map((r) => r.slug).filter((s): s is string => !!s);
	return uniqueSlug(slugify(label ?? "server", "server"), taken);
}

export async function allocProjectSlug(
	serverKeyId: string,
	name: string,
	database: Pick<typeof db, "select"> = db,
): Promise<string> {
	const rows = await database
		.select({ slug: projects.slug })
		.from(projects)
		.where(eq(projects.serverKeyId, serverKeyId));
	const taken = rows.map((r) => r.slug).filter((s): s is string => !!s);
	return uniqueSlug(slugify(name, "project"), taken);
}
