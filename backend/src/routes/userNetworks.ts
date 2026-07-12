// backend/src/routes/userNetworks.ts

import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "../db/index";
import {
	memberships,
	networkInvites,
	networks,
	serverDataSources,
	serverKeyHelloes,
	serverKeys,
	serverModules,
	users,
} from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { can, type Role } from "../lib/capabilities";
import {
	createInvite,
	listInvites,
	revokeInvite,
} from "../lib/inviteStorage";
import { requireCapability, requireMember } from "../lib/membershipGuard";
import { addMembership } from "../lib/membershipManager";
import { createNetwork } from "../lib/networkManager";
import { createProject, listProjectsForNetwork } from "../lib/projectStorage";
import { slugify } from "../lib/slug";
import { allocServerSlug } from "../lib/slugAlloc";
import type { AuthUser } from "../middleware/userAuth";
import { disconnectServerKey, getInstanceCount } from "../ws/hub";
import { handleResourcePackRebuild } from "./resourcePack";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

type Vars = { user: AuthUser | null };

/**
 * Number of authorable documents (menus + commands + dialogs) inside a
 * project's editor JSON. Surfaced in the network detail so the sidebar +
 * project list can show a count indicator without loading the full project.
 * Returns 0 on missing/corrupt JSON — the count is informational, never
 * load-bearing.
 */
function countProjectDocuments(editorJson: string | null): number {
	if (!editorJson) return 0;
	try {
		const e = JSON.parse(editorJson) as {
			menus?: unknown[];
			commands?: unknown[];
			dialogs?: unknown[];
		};
		return (
			(e.menus?.length ?? 0) + (e.commands?.length ?? 0) + (e.dialogs?.length ?? 0)
		);
	} catch {
		return 0;
	}
}

export const userNetworksRouter = new Hono<{ Variables: Vars }>();

// Helper: get authenticated userId or return null
function getUserId(c: Context<{ Variables: Vars }>): string | null {
	const user = c.get("user");
	return user?.id ?? null;
}

// GET /api/networks — list user's networks
userNetworksRouter.get("/", async (c: Context<{ Variables: Vars }>) => {
	const userId = getUserId(c);
	if (!userId) return c.json({ error: "unauthorized" }, 401);

	const memb = await db
		.select({ networkId: memberships.networkId })
		.from(memberships)
		.where(eq(memberships.userId, userId));
	if (memb.length === 0) return c.json({ networks: [] });
	const list = await db
		.select()
		.from(networks)
		.where(
			inArray(
				networks.id,
				memb.map((m) => m.networkId),
			),
		);
	return c.json({ networks: list });
});

// POST /api/networks — create network + owner membership
userNetworksRouter.post("/", async (c: Context<{ Variables: Vars }>) => {
	const userId = getUserId(c);
	if (!userId) return c.json({ error: "unauthorized" }, 401);

	let body: { name?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "invalid_body" }, 400);
	}
	if (typeof body.name !== "string" || body.name.trim().length === 0) {
		return c.json({ error: "invalid_name" }, 422);
	}
	const network = await createNetwork(body.name.trim());
	await addMembership(userId, network.id, "owner");
	return c.json({ network }, 201);
});

// GET /api/networks/:id — detail with packs + serverKeys
userNetworksRouter.get("/:id", async (c: Context<{ Variables: Vars }>) => {
	const userId = getUserId(c);
	if (!userId) return c.json({ error: "unauthorized" }, 401);

	const param = c.req.param("id");
	// Resolve by id OR slug — URLs use slugs, but old id-based links still work.
	const netRows = await db
		.select()
		.from(networks)
		.where(or(eq(networks.id, param), eq(networks.slug, param)));
	if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
	const network = netRows[0];
	try {
		await requireMember(userId, network.id);
	} catch {
		return c.json({ error: "forbidden" }, 403);
	}
	const projectsList = await listProjectsForNetwork(network.id);
	const projectsWithCounts = projectsList.map((p) => ({
		...p,
		documentCount: countProjectDocuments(p.editorJson),
	}));
	const skList = await db
		.select()
		.from(serverKeys)
		.where(eq(serverKeys.networkId, network.id));
	return c.json({ network, projects: projectsWithCounts, serverKeys: skList });
});

// PATCH /api/networks/:id — update name and/or slug (member required)
userNetworksRouter.patch("/:id", async (c: Context<{ Variables: Vars }>) => {
	const userId = getUserId(c);
	if (!userId) return c.json({ error: "unauthorized" }, 401);

	const param = c.req.param("id");
	// Resolve by id OR slug, like GET /:id — callers may hold either.
	const netRows = await db
		.select()
		.from(networks)
		.where(or(eq(networks.id, param), eq(networks.slug, param)));
	if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
	const network = netRows[0];
	try {
		await requireMember(userId, network.id);
	} catch {
		return c.json({ error: "forbidden" }, 403);
	}

	let body: { name?: unknown; slug?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "invalid_body" }, 400);
	}

	const updates: { name?: string; slug?: string; updatedAt: Date } = {
		updatedAt: new Date(),
	};
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || body.name.trim().length === 0) {
			return c.json({ error: "invalid_name" }, 422);
		}
		updates.name = body.name.trim();
	}
	if (body.slug !== undefined) {
		// Slug must already be in canonical form — the UI slugifies as the user
		// types; accepting raw input here would silently rewrite the URL.
		if (
			typeof body.slug !== "string" ||
			body.slug.length === 0 ||
			slugify(body.slug) !== body.slug
		) {
			return c.json({ error: "invalid_slug" }, 422);
		}
		const taken = await db
			.select({ id: networks.id })
			.from(networks)
			.where(and(eq(networks.slug, body.slug), ne(networks.id, network.id)));
		if (taken.length > 0) return c.json({ error: "slug_taken" }, 409);
		updates.slug = body.slug;
	}
	if (updates.name === undefined && updates.slug === undefined) {
		return c.json({ error: "no_fields" }, 422);
	}

	const [updated] = await db
		.update(networks)
		.set(updates)
		.where(eq(networks.id, network.id))
		.returning();
	return c.json({ network: updated });
});

// PATCH /api/networks/:id/server-keys/:keyId — update label and/or slug
userNetworksRouter.patch(
	"/:id/server-keys/:keyId",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);

		const param = c.req.param("id");
		const netRows = await db
			.select()
			.from(networks)
			.where(or(eq(networks.id, param), eq(networks.slug, param)));
		if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
		const network = netRows[0];
		try {
			await requireMember(userId, network.id);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const keyId = c.req.param("keyId");
		const keyRows = await db
			.select()
			.from(serverKeys)
			.where(and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, network.id)));
		if (keyRows.length === 0) return c.json({ error: "not_found" }, 404);

		let body: { label?: unknown; slug?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid_body" }, 400);
		}

		const updates: { label?: string; slug?: string } = {};
		if (body.label !== undefined) {
			if (typeof body.label !== "string" || body.label.trim().length === 0) {
				return c.json({ error: "invalid_label" }, 422);
			}
			updates.label = body.label.trim();
		}
		if (body.slug !== undefined) {
			if (
				typeof body.slug !== "string" ||
				body.slug.length === 0 ||
				slugify(body.slug) !== body.slug
			) {
				return c.json({ error: "invalid_slug" }, 422);
			}
			// Unique per network (mirrors server_keys_network_slug_uniq).
			const taken = await db
				.select({ id: serverKeys.id })
				.from(serverKeys)
				.where(
					and(
						eq(serverKeys.networkId, network.id),
						eq(serverKeys.slug, body.slug),
						ne(serverKeys.id, keyId),
					),
				);
			if (taken.length > 0) return c.json({ error: "slug_taken" }, 409);
			updates.slug = body.slug;
		}
		if (updates.label === undefined && updates.slug === undefined) {
			return c.json({ error: "no_fields" }, 422);
		}

		const [updated] = await db
			.update(serverKeys)
			.set(updates)
			.where(eq(serverKeys.id, keyId))
			.returning();
		return c.json({ id: updated.id, label: updated.label, slug: updated.slug });
	},
);

// POST /api/networks/:id/server-keys — create server_key in network
userNetworksRouter.post(
	"/:id/server-keys",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);

		const networkId = c.req.param("id");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		let body: { label?: unknown } = {};
		try {
			body = await c.req.json();
		} catch {
			/* empty body ok */
		}
		const label = typeof body.label === "string" ? body.label : null;

		const slug = await allocServerSlug(networkId, label);
		const { id, key, hash } = await generateServerKey();
		await db.insert(serverKeys).values({
			id,
			hash,
			label,
			slug,
			networkId,
			createdAt: new Date(),
		});
		return c.json({ id, key, label, slug }, 201);
	},
);

// POST /api/networks/:id/projects — create project in network (V1: project belongs to one server_key)
userNetworksRouter.post(
	"/:id/projects",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);

		const networkId = c.req.param("id");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const body = await c.req.json<{
			name?: string;
			description?: string;
			serverKeyId?: string;
		}>();
		if (typeof body.name !== "string" || body.name.trim().length === 0) {
			return c.json({ error: "invalid_name" }, 422);
		}
		if (typeof body.serverKeyId !== "string" || body.serverKeyId.length === 0) {
			return c.json({ error: "missing_server_key" }, 422);
		}
		const skRows = await db
			.select()
			.from(serverKeys)
			.where(
				and(
					eq(serverKeys.id, body.serverKeyId),
					eq(serverKeys.networkId, networkId),
				),
			);
		if (skRows.length === 0)
			return c.json({ error: "server_key_not_in_network" }, 403);

		const project = await createProject({
			networkId,
			serverKeyId: body.serverKeyId,
			name: body.name.trim(),
			description: body.description ?? null,
		});
		return c.json({ project }, 201);
	},
);

// GET /api/networks/:id/server-keys/:keyId/helloes?limit=30 — owner only.
// Audit timeline of plugin connections. The admin uses this to spot anomalies
// (unexpected IPs, hellos at odd hours) and decide whether to rotate the key.
userNetworksRouter.get(
	"/:id/server-keys/:keyId/helloes",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireCapability(userId, networkId, "manage_servers");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);

		const rawLimit = parseInt(c.req.query("limit") ?? "30", 10);
		const limit = Math.min(
			Math.max(isFinite(rawLimit) ? rawLimit : 30, 1),
			200,
		);

		const rows = await db
			.select()
			.from(serverKeyHelloes)
			.where(eq(serverKeyHelloes.serverKeyId, keyId))
			.orderBy(desc(serverKeyHelloes.helloAt))
			.limit(limit);

		return c.json({
			helloes: rows.map((r) => ({
				id: r.id,
				ip: r.ip,
				mc_version: r.mcVersion,
				hello_at: r.helloAt.toISOString(),
				rejected_reason: r.rejectedReason,
			})),
		});
	},
);

// GET /api/networks/:id/server-keys/:keyId/allowlist — owner only.
// Returns the optional source-IP allowlist. null/empty = no restriction.
userNetworksRouter.get(
	"/:id/server-keys/:keyId/allowlist",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireCapability(userId, networkId, "manage_servers");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);
		return c.json({ allowed_ips: sk[0].allowedIps ?? null });
	},
);

// PUT /api/networks/:id/server-keys/:keyId/allowlist — owner only.
// Body `{ allowed_ips: string[] | null }`. Pass null (or omit) to remove the
// restriction; pass an array to require source IP membership on hello.
userNetworksRouter.put(
	"/:id/server-keys/:keyId/allowlist",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireCapability(userId, networkId, "manage_servers");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		let body: { allowed_ips?: unknown } = {};
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid_body" }, 400);
		}

		let allowedIps: string[] | null;
		if (body.allowed_ips === null || body.allowed_ips === undefined) {
			allowedIps = null;
		} else if (
			Array.isArray(body.allowed_ips) &&
			body.allowed_ips.every(
				(v) => typeof v === "string" && v.trim().length > 0,
			)
		) {
			// Dedup + trim. We don't validate IP syntax — admins may have IPv4, IPv6,
			// x-forwarded-for chains, or "unknown" (proxied env without IP header).
			allowedIps = Array.from(
				new Set((body.allowed_ips as string[]).map((s) => s.trim())),
			);
			if (allowedIps.length === 0) allowedIps = null;
		} else {
			return c.json({ error: "invalid_allowed_ips" }, 422);
		}

		const updated = await db
			.update(serverKeys)
			.set({ allowedIps })
			.where(and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)))
			.returning({ id: serverKeys.id });
		if (updated.length === 0) return c.json({ error: "not_found" }, 404);

		return c.json({ allowed_ips: allowedIps });
	},
);

// POST /api/networks/:id/server-keys/:keyId/rotate — owner only.
// Generates a new plaintext key for the same row (id/label/bindings preserved),
// invalidates the old hash, and forcefully drops the auth on any live plugin
// connection still using the old key.
userNetworksRouter.post(
	"/:id/server-keys/:keyId/rotate",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireCapability(userId, networkId, "manage_servers");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const existing = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)),
			);
		if (existing.length === 0) return c.json({ error: "not_found" }, 404);

		const { key, hash } = await generateServerKey();
		await db.update(serverKeys).set({ hash }).where(eq(serverKeys.id, keyId));
		disconnectServerKey(keyId);

		return c.json({ id: keyId, key, label: existing[0].label });
	},
);

// GET /api/networks/:id/server-keys/:keyId/status — member access
userNetworksRouter.get(
	"/:id/server-keys/:keyId/status",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);
		return c.json({ online: getInstanceCount(keyId) > 0 });
	},
);

// GET /api/networks/:id/servers-status?current=<serverKeyId> — member access.
// Read-only aggregate for the topbar linked-servers badge + dropdown: one row
// per server key with live online state (in-memory instance count) and the
// last *accepted* hello (last-seen time + IP). Polled by the editor.
userNetworksRouter.get(
	"/:id/servers-status",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const current = c.req.query("current") ?? null;
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const keys = await db
			.select()
			.from(serverKeys)
			.where(eq(serverKeys.networkId, networkId));

		const ids = keys.map((k) => k.id);
		const lastHelloes = ids.length
			? await db
					.selectDistinctOn([serverKeyHelloes.serverKeyId], {
						serverKeyId: serverKeyHelloes.serverKeyId,
						ip: serverKeyHelloes.ip,
						helloAt: serverKeyHelloes.helloAt,
					})
					.from(serverKeyHelloes)
					.where(
						and(
							inArray(serverKeyHelloes.serverKeyId, ids),
							isNull(serverKeyHelloes.rejectedReason),
						),
					)
					.orderBy(
						serverKeyHelloes.serverKeyId,
						desc(serverKeyHelloes.helloAt),
					)
			: [];
		const helloById = new Map(lastHelloes.map((h) => [h.serverKeyId, h]));

		const servers = keys.map((k) => {
			const instanceCount = getInstanceCount(k.id);
			const hello = helloById.get(k.id);
			return {
				id: k.id,
				label: k.label,
				online: instanceCount > 0,
				instanceCount,
				lastMcVersion: k.lastMcVersion,
				lastSeenAt: hello ? hello.helloAt.toISOString() : null,
				lastSeenIp: hello ? hello.ip : null,
				isCurrent: k.id === current,
			};
		});
		const online = servers.filter((s) => s.online).length;
		return c.json({ servers, online, total: servers.length });
	},
);

// GET /api/networks/:networkId/servers/:serverId/modules — member access.
// User-scoped twin of GET /api/v1/editor-session/:token/modules — same
// response shape, cookie auth instead of the session token (Task 1 of the
// accounts-only cutover, cf. docs/decisions/accounts-only-editing.md).
userNetworksRouter.get(
	"/:networkId/servers/:serverId/modules",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("networkId");
		const serverId = c.req.param("serverId");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, serverId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);

		const rows = await db
			.select()
			.from(serverModules)
			.where(eq(serverModules.serverKeyId, sk[0].id));
		return c.json({
			modules: rows.map((r) => ({ id: r.moduleId, version: r.version })),
		});
	},
);

// GET /api/networks/:networkId/servers/:serverId/data-sources — member access.
// User-scoped twin of GET /api/v1/editor-session/:token/data-sources.
userNetworksRouter.get(
	"/:networkId/servers/:serverId/data-sources",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("networkId");
		const serverId = c.req.param("serverId");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, serverId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);

		const rows = await db
			.select()
			.from(serverDataSources)
			.where(eq(serverDataSources.serverKeyId, sk[0].id));
		return c.json({
			data_sources: rows.map((r) => ({ ref: r.ref, schema_hint: r.schemaHint })),
		});
	},
);

// POST /api/networks/:networkId/servers/:serverId/resource-pack/rebuild — member access.
// User-scoped twin of POST /api/v1/editor-session/:token/resource-pack/rebuild
// (resourcePackAdminRouter) — same response shape, cookie auth instead of the
// session token (Task 2 of the accounts-only cutover).
userNetworksRouter.post(
	"/:networkId/servers/:serverId/resource-pack/rebuild",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("networkId");
		const serverId = c.req.param("serverId");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, serverId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);

		return handleResourcePackRebuild(c, sk[0].id);
	},
);

// DELETE /api/networks/:id/server-keys/:keyId — owner only
userNetworksRouter.delete(
	"/:id/server-keys/:keyId",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const keyId = c.req.param("keyId");
		try {
			await requireCapability(userId, networkId, "manage_servers");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		// projects.serverKeyId has ON DELETE CASCADE — deleting the server_key cascades to its projects.
		await db
			.delete(serverKeys)
			.where(
				and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)),
			);
		return c.body(null, 204);
	},
);

/**
 * Number of memberships in a network whose role grants "manage_members" —
 * i.e. how many owners remain. Used to guard the last-owner invariant on
 * self-removal, removal, and demotion.
 */
async function countManagers(networkId: string): Promise<number> {
	const rows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(eq(memberships.networkId, networkId));
	return rows.filter((r) => can(r.role, "manage_members")).length;
}

// GET /api/networks/:id/members — owner only. Joined with users for
// display fields (email/displayName).
userNetworksRouter.get(
	"/:id/members",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const rows = await db
			.select({
				userId: memberships.userId,
				email: users.email,
				displayName: users.name,
				role: memberships.role,
				createdAt: memberships.createdAt,
			})
			.from(memberships)
			.innerJoin(users, eq(users.id, memberships.userId))
			.where(eq(memberships.networkId, networkId));
		return c.json({ members: rows });
	},
);

// DELETE /api/networks/:id/members/:userId — owner only. A member (including
// the caller) can be removed unless it's the last manage_members-capable
// member — that would leave the network without anyone able to manage it.
userNetworksRouter.delete(
	"/:id/members/:userId",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const targetUserId = c.req.param("userId");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const targetRows = await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.userId, targetUserId),
					eq(memberships.networkId, networkId),
				),
			);
		if (targetRows.length === 0) return c.json({ error: "not_found" }, 404);

		if (can(targetRows[0].role, "manage_members")) {
			const managers = await countManagers(networkId);
			if (managers <= 1) {
				return c.json({ error: "last_owner" }, 409);
			}
		}

		await db
			.delete(memberships)
			.where(
				and(
					eq(memberships.userId, targetUserId),
					eq(memberships.networkId, networkId),
				),
			);
		return c.body(null, 204);
	},
);

// PATCH /api/networks/:id/members/:userId — owner only. Body { role }.
userNetworksRouter.patch(
	"/:id/members/:userId",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const targetUserId = c.req.param("userId");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		let body: { role?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid_body" }, 400);
		}
		if (body.role !== "owner" && body.role !== "member") {
			return c.json({ error: "invalid_role" }, 422);
		}
		const newRole = body.role as Role;

		const targetRows = await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.userId, targetUserId),
					eq(memberships.networkId, networkId),
				),
			);
		if (targetRows.length === 0) return c.json({ error: "not_found" }, 404);

		// Demoting a manage_members-capable member to a role without it — guard
		// against removing the last one.
		const wasManager = can(targetRows[0].role, "manage_members");
		const willBeManager = can(newRole, "manage_members");
		if (wasManager && !willBeManager) {
			const managers = await countManagers(networkId);
			if (managers <= 1) {
				return c.json({ error: "last_owner" }, 409);
			}
		}

		await db
			.update(memberships)
			.set({ role: newRole })
			.where(
				and(
					eq(memberships.userId, targetUserId),
					eq(memberships.networkId, networkId),
				),
			);
		return c.json({ ok: true });
	},
);

// POST /api/networks/:id/invites — owner only.
userNetworksRouter.post(
	"/:id/invites",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		let body: { email?: unknown; maxUses?: unknown; expiresInDays?: unknown } = {};
		try {
			body = await c.req.json();
		} catch {
			/* empty body ok — all fields optional */
		}
		const email = typeof body.email === "string" ? body.email.trim() || null : null;
		const maxUses =
			typeof body.maxUses === "number" && Number.isFinite(body.maxUses)
				? body.maxUses
				: null;
		const expiresInDays =
			typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays)
				? body.expiresInDays
				: undefined;

		const invite = await createInvite({
			networkId,
			createdBy: userId,
			email,
			maxUses,
			expiresInDays,
		});
		return c.json(
			{
				invite: {
					id: invite.id,
					code: invite.code,
					url: `${EDITOR_URL}/invite?code=${invite.code}`,
					email: invite.email,
					maxUses: invite.maxUses,
					usedCount: invite.usedCount,
					expiresAt: invite.expiresAt.toISOString(),
				},
			},
			201,
		);
	},
);

// GET /api/networks/:id/invites — owner only.
userNetworksRouter.get(
	"/:id/invites",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const list = await listInvites(networkId);
		return c.json({
			invites: list.map((i) => ({
				id: i.id,
				code: i.code,
				url: `${EDITOR_URL}/invite?code=${i.code}`,
				email: i.email,
				maxUses: i.maxUses,
				usedCount: i.usedCount,
				expiresAt: i.expiresAt.toISOString(),
				revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
			})),
		});
	},
);

// DELETE /api/networks/:id/invites/:inviteId — owner only.
userNetworksRouter.delete(
	"/:id/invites/:inviteId",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const inviteId = c.req.param("inviteId");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const rows = await db
			.select({ id: networkInvites.id })
			.from(networkInvites)
			.where(
				and(
					eq(networkInvites.id, inviteId),
					eq(networkInvites.networkId, networkId),
				),
			);
		if (rows.length === 0) return c.json({ error: "not_found" }, 404);

		await revokeInvite(inviteId);
		return c.body(null, 204);
	},
);
