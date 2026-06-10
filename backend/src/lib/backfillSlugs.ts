import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks, packs, serverKeys } from "../db/schema";
import { slugify, uniqueSlug } from "./slug";

/**
 * One-time backfill: assign URL slugs to networks / server_keys / packs created
 * before the slug columns existed. Idempotent — only rows where `slug IS NULL`
 * are touched. Scopes mirror the unique indexes: network slug is global, server
 * slug is unique per network, pack slug is unique per server key.
 */
export async function backfillSlugs(): Promise<void> {
	// Networks — global uniqueness.
	const allNetworks = await db
		.select({ id: networks.id, name: networks.name, slug: networks.slug })
		.from(networks);
	const takenNet = new Set(
		allNetworks.map((n) => n.slug).filter((s): s is string => !!s),
	);
	for (const n of allNetworks) {
		if (n.slug) continue;
		const slug = uniqueSlug(slugify(n.name, "network"), takenNet);
		takenNet.add(slug);
		await db.update(networks).set({ slug }).where(eq(networks.id, n.id));
	}

	// Server keys — unique per network.
	const allKeys = await db
		.select({
			id: serverKeys.id,
			label: serverKeys.label,
			networkId: serverKeys.networkId,
			slug: serverKeys.slug,
		})
		.from(serverKeys);
	const takenKeyByNet = new Map<string, Set<string>>();
	for (const k of allKeys) {
		const set = takenKeyByNet.get(k.networkId) ?? new Set<string>();
		if (k.slug) set.add(k.slug);
		takenKeyByNet.set(k.networkId, set);
	}
	for (const k of allKeys) {
		if (k.slug) continue;
		const set = takenKeyByNet.get(k.networkId) as Set<string>;
		const slug = uniqueSlug(slugify(k.label ?? "server", "server"), set);
		set.add(slug);
		await db.update(serverKeys).set({ slug }).where(eq(serverKeys.id, k.id));
	}

	// Packs — unique per server key.
	const allPacks = await db
		.select({
			id: packs.id,
			name: packs.name,
			serverKeyId: packs.serverKeyId,
			slug: packs.slug,
		})
		.from(packs);
	const takenPackByKey = new Map<string, Set<string>>();
	for (const p of allPacks) {
		const set = takenPackByKey.get(p.serverKeyId) ?? new Set<string>();
		if (p.slug) set.add(p.slug);
		takenPackByKey.set(p.serverKeyId, set);
	}
	for (const p of allPacks) {
		if (p.slug) continue;
		const set = takenPackByKey.get(p.serverKeyId) as Set<string>;
		const slug = uniqueSlug(slugify(p.name, "workspace"), set);
		set.add(slug);
		await db.update(packs).set({ slug }).where(eq(packs.id, p.id));
	}
}
