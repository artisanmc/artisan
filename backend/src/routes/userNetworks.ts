// backend/src/routes/userNetworks.ts

import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "../db/index";
import {
	memberships,
	networkAccessRequests,
	networkInvites,
	networks,
	serverDataSources,
	serverDeclaredModels,
	serverEditorScreens,
	serverKeyHelloes,
	serverKeys,
	serverModules,
	users,
} from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { mintLinkCode } from "../lib/linkCodeStorage";
import { can, type Role } from "../lib/capabilities";
import {
	createRequest,
	listRequests,
	resolveRequest,
} from "../lib/accessRequestStorage";
import {
	createInvite,
	listInvites,
	revokeInvite,
} from "../lib/inviteStorage";
import { sendSafely } from "../lib/mail/mailer";
import { accessRequestEmail, inviteEmail } from "../lib/mail/templates";
import { requireCapability, requireMember, withNetworkMemberLock } from "../lib/membershipGuard";
import { addMembership } from "../lib/membershipManager";
import { createNetwork } from "../lib/networkManager";
import { readOwnerModuleFromFiles } from "../lib/projectFiles";
import { createProject, listProjectsForNetwork } from "../lib/projectStorage";
import { slugify } from "../lib/slug";
import { allocServerSlug } from "../lib/slugAlloc";
import type { AuthUser } from "../middleware/userAuth";
import { disconnectServerKey, getInstanceCount, requestConfigRead, requestConfigWrite, requestDataSourceFetch, requestPlayerInventory } from "../ws/hub";
import { handleResourcePackRebuild } from "./resourcePack";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

type Vars = { user: AuthUser | null };

/**
 * Number of authorable documents (menus + commands + dialogs) in a project's
 * file tree (files-first: the tree is the only stored representation).
 * Surfaced in the network detail so the sidebar + project list can show a
 * count indicator without loading the full project. Returns 0 on
 * missing/corrupt JSON — the count is informational, never load-bearing.
 */
function countProjectDocuments(filesJson: string | null): number {
	if (!filesJson) return 0;
	try {
		const files = JSON.parse(filesJson) as Record<string, string>;
		return Object.keys(files).filter((path) =>
			/\/(menus|commands|dialogs)\/[^/]+\.ya?ml$/.test(path),
		).length;
	} catch {
		return 0;
	}
}

/** Parsed declared schema of a server data source — [] on null/corrupt JSON (informational, never load-bearing). */
function parseSchemaJson(raw: string | null): { name: string; type: string; description?: string | null }[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
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
	const projectsWithCounts = projectsList.map((p) => {
		let files: Record<string, string> = {};
		try {
			files = JSON.parse(p.filesJson) as Record<string, string>;
		} catch {
			/* informational only */
		}
		return {
			...p,
			documentCount: countProjectDocuments(p.filesJson),
			ownerModule: readOwnerModuleFromFiles(files, p.id),
		};
	});
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
		await requireCapability(userId, network.id, "manage_network");
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
			await requireCapability(userId, network.id, "manage_servers");
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
			await requireCapability(userId, networkId, "manage_servers");
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
		// Created unredeemed (hash NULL, no secret): the admin runs
		// `/artisan link <code>` on the server, which mints + returns the secret.
		const id = "srv_" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
		await db.insert(serverKeys).values({
			id,
			hash: null,
			label,
			slug,
			networkId,
			createdAt: new Date(),
		});
		const { code, expiresAt } = await mintLinkCode(id);
		return c.json({ id, label, slug, code, expires_at: expiresAt.toISOString() }, 201);
	},
);

// POST /api/networks/:id/server-keys/:keyId/link-code — mint a fresh link code
// for an existing server key (re-link / rotate). manage_servers only.
userNetworksRouter.post(
	"/:id/server-keys/:keyId/link-code",
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
		const rows = await db
			.select({ id: serverKeys.id })
			.from(serverKeys)
			.where(and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)));
		if (rows.length === 0) return c.json({ error: "server_key_not_in_network" }, 404);
		const { code, expiresAt } = await mintLinkCode(keyId);
		return c.json({ code, expires_at: expiresAt.toISOString() }, 201);
	},
);

// POST /api/networks/:id/projects — create project in network (V1: project belongs to one server_key)
userNetworksRouter.post(
	"/:id/projects",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);

		const networkId = await resolveNetworkForMember(userId, c.req.param("id"));
		if (!networkId) return c.json({ error: "forbidden" }, 403);

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
		const networkId = await resolveNetworkForMember(userId, c.req.param("id"));
		if (!networkId) return c.json({ error: "forbidden" }, 403);
		const keyId = c.req.param("keyId");
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
		const networkId = await resolveNetworkForMember(userId, c.req.param("id"));
		if (!networkId) return c.json({ error: "forbidden" }, 403);
		const current = c.req.query("current") ?? null;

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

/**
 * Résout un `:id` de network (id **ou** slug) et vérifie l'appartenance.
 * Renvoie null si inconnu ou non-membre — les deux se répondent en 403 pour
 * ne pas révéler l'existence d'un network dont on n'est pas membre.
 */
async function resolveNetworkForMember(userId: string, ref: string): Promise<string | null> {
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
 * Résout `:networkId` et `:serverId` qui peuvent être des **id ou des slugs** —
 * les URLs de l'éditeur portent les slugs. Le serveur est résolu SCOPÉ au
 * network (les slugs de serveur ne sont uniques que par network), donc jamais
 * celui d'un autre réseau.
 *
 * Renvoie null quand le network est inconnu ou que l'appelant n'en est pas
 * membre ; `serverKeyId` null quand le serveur n'existe pas dans ce network.
 */
async function resolveNetworkServer(
	userId: string,
	networkRef: string,
	serverRef: string,
): Promise<{ networkId: string; serverKeyId: string | null } | null> {
	const nets = await db
		.select({ id: networks.id })
		.from(networks)
		.where(or(eq(networks.id, networkRef), eq(networks.slug, networkRef)));
	const networkId = nets[0]?.id;
	if (!networkId) return null;
	try {
		await requireMember(userId, networkId);
	} catch {
		return null;
	}
	const sk = await db
		.select({ id: serverKeys.id })
		.from(serverKeys)
		.where(
			and(
				eq(serverKeys.networkId, networkId),
				or(eq(serverKeys.id, serverRef), eq(serverKeys.slug, serverRef)),
			),
		);
	return { networkId, serverKeyId: sk[0]?.id ?? null };
}

// GET /api/networks/:networkId/servers/:serverId/modules — member access.
// User-scoped twin of GET /api/v1/editor-session/:token/modules — same
// response shape, cookie auth instead of the session token (Task 1 of the
// accounts-only cutover, cf. docs/decisions/accounts-only-editing.md).
userNetworksRouter.get(
	"/:networkId/servers/:serverId/modules",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

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
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const rows = await db
			.select()
			.from(serverDataSources)
			.where(eq(serverDataSources.serverKeyId, sk[0].id));
		return c.json({
			data_sources: rows.map((r) => ({
				ref: r.ref,
				module_id: r.moduleId,
				schema: parseSchemaJson(r.schemaJson),
				schema_hint: r.schemaHint,
				stability: r.stability,
				key_field: r.keyField,
			})),
		});
	},
);

// GET /api/networks/:networkId/servers/:serverId/models — member access.
// Module-declared Data models reported at Presence (ADR composable-data-models
// §4): model/v1 documents, verbatim.
userNetworksRouter.get(
	"/:networkId/servers/:serverId/models",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const rows = await db
			.select()
			.from(serverDeclaredModels)
			.where(eq(serverDeclaredModels.serverKeyId, sk[0].id));
		return c.json({
			models: rows
				.map((r) => {
					try {
						return JSON.parse(r.documentJson) as Record<string, unknown>;
					} catch {
						return null;
					}
				})
				.filter((d): d is Record<string, unknown> => d !== null)
				.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)),
		});
	},
);

// GET /api/networks/:networkId/servers/:serverId/screens — member access.
// Module-declared Config screens reported at Presence (ADR module-config-screens):
// wire objects verbatim ({id, module_id, label, table, project_id}).
userNetworksRouter.get(
	"/:networkId/servers/:serverId/screens",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const rows = await db
			.select()
			.from(serverEditorScreens)
			.where(eq(serverEditorScreens.serverKeyId, sk[0].id));
		return c.json({
			screens: rows
				.map((r) => {
					try {
						return JSON.parse(r.screenJson) as Record<string, unknown>;
					} catch {
						return null;
					}
				})
				.filter((s): s is Record<string, unknown> => s !== null)
				.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)),
		});
	},
);

// POST /api/networks/:networkId/servers/:serverId/config/read — member access.
// Config screens live channel (ADR module-config-screens): read a table's files
// from the plugin's disk over the WS relay. Body: {project_id, table}.
userNetworksRouter.post(
	"/:networkId/servers/:serverId/config/read",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const body = (await c.req.json().catch(() => null)) as {
			project_id?: unknown;
			table?: unknown;
		} | null;
		if (!body || typeof body.project_id !== "string" || body.project_id.length === 0 ||
			typeof body.table !== "string" || body.table.length === 0) {
			return c.json({ error: "invalid_input" }, 422);
		}

		const outcome = await requestConfigRead(sk[0].id, {
			projectId: body.project_id,
			table: body.table,
		});
		if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
		if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
		const r = outcome.result;
		if (!r.ok) {
			const error = r.error ?? "read_error";
			const status = error === "unknown_project" ? 404 : error === "invalid_path" ? 422 : 502;
			return c.json({ error, message: r.message ?? null }, status);
		}
		return c.json({ files: r.files ?? [] });
	},
);

// POST /api/networks/:networkId/servers/:serverId/config/write — member access.
// Config screens live channel: write a table's files to the plugin's disk (it
// hot-reloads and auto-pushes through the normal sync loop). Body:
// {project_id, files: [{path, content}], deletes?: [path]}.
userNetworksRouter.post(
	"/:networkId/servers/:serverId/config/write",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const body = (await c.req.json().catch(() => null)) as {
			project_id?: unknown;
			files?: unknown;
			deletes?: unknown;
		} | null;
		const files = Array.isArray(body?.files)
			? (body.files as unknown[]).filter(
					(f): f is { path: string; content: string } =>
						typeof f === "object" && f !== null &&
						typeof (f as Record<string, unknown>).path === "string" &&
						typeof (f as Record<string, unknown>).content === "string",
				)
			: null;
		const deletes = Array.isArray(body?.deletes)
			? (body.deletes as unknown[]).filter((d): d is string => typeof d === "string")
			: [];
		if (!body || typeof body.project_id !== "string" || body.project_id.length === 0 ||
			files === null || (files.length === 0 && deletes.length === 0)) {
			return c.json({ error: "invalid_input" }, 422);
		}

		const outcome = await requestConfigWrite(sk[0].id, {
			projectId: body.project_id,
			files,
			deletes,
		});
		if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
		if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
		const r = outcome.result;
		if (!r.ok) {
			const error = r.error ?? "write_error";
			const status = error === "unknown_project" ? 404 : error === "invalid_path" ? 422 : 502;
			return c.json({ error, message: r.message ?? null }, status);
		}
		return c.json({ ok: true });
	},
);

// POST /api/networks/:networkId/servers/:serverId/data-sources/preview — member access.
// Live fetch relayed to the connected plugin over the WS (data_source_fetch /
// data_source_fetch_result, 5 s timeout). Body: {ref, params?, filter?, sort?,
// limit?, args?} — args = test values for {arg} tokens (runtime interpolation).
userNetworksRouter.post(
	"/:networkId/servers/:serverId/data-sources/preview",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const body = (await c.req.json().catch(() => null)) as {
			ref?: unknown;
			params?: Record<string, unknown>;
			filter?: Record<string, string>;
			sort?: { by: string; direction?: "asc" | "desc" } | null;
			limit?: number | null;
			args?: Record<string, string>;
		} | null;
		if (!body || typeof body.ref !== "string" || body.ref.length === 0) {
			return c.json({ error: "invalid_input" }, 422);
		}

		const outcome = await requestDataSourceFetch(sk[0].id, {
			ref: body.ref,
			params: body.params,
			filter: body.filter,
			sort: body.sort,
			limit: body.limit,
			args: body.args,
		});
		if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
		if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
		const r = outcome.result;
		if (!r.ok) {
			const error = r.error ?? "fetch_error";
			const status = error === "unknown_source" ? 404 : error === "player_required" ? 422 : 502;
			return c.json({ error, message: r.message ?? null }, status);
		}
		return c.json({ rows: r.rows ?? [], truncated: r.truncated ?? false });
	},
);

// GET /api/networks/:networkId/servers/:serverId/player-inventory?player=X — member access.
// Snapshot of an online player's inventory, relayed to the connected plugin
// (player_inventory_fetch / player_inventory_result, 5 s timeout). Feeds the
// editor's capture panel (ADR captured-items-and-module-field-kit).
userNetworksRouter.get(
	"/:networkId/servers/:serverId/player-inventory",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

		const player = c.req.query("player")?.trim();
		if (!player) return c.json({ error: "invalid_input" }, 422);

		const outcome = await requestPlayerInventory(sk[0].id, player);
		if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
		if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
		const r = outcome.result;
		if (!r.ok) {
			const error = r.error ?? "fetch_error";
			const status = error === "player_not_found" ? 404 : 502;
			return c.json({ error, message: r.message ?? null }, status);
		}
		return c.json({ slots: r.slots ?? [] });
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
		const resolved = await resolveNetworkServer(
			userId,
			c.req.param("networkId"),
			c.req.param("serverId"),
		);
		if (!resolved) return c.json({ error: "forbidden" }, 403);
		const networkId = resolved.networkId;
		if (!resolved.serverKeyId) return c.json({ error: "not_found" }, 404);
		const sk = [{ id: resolved.serverKeyId }];

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
async function countManagers(
	networkId: string,
	executor: Pick<typeof db, "select"> = db,
): Promise<number> {
	const rows = await executor
		.select({ role: memberships.role })
		.from(memberships)
		.where(eq(memberships.networkId, networkId));
	return rows.filter((r) => can(r.role, "manage_members")).length;
}

// GET /api/networks/:id/members — any member (read-only roster). Joined
// with users for display fields (email/displayName).
userNetworksRouter.get(
	"/:id/members",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = await resolveNetworkForMember(userId, c.req.param("id"));
		if (!networkId) return c.json({ error: "forbidden" }, 403);

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

		// Check + mutation run inside a single transaction holding a per-network
		// advisory lock (withNetworkMemberLock) — otherwise two concurrent
		// requests against the last two managers could both pass the
		// countManagers check before either deletes, leaving zero managers.
		const result = await withNetworkMemberLock(networkId, async (tx) => {
			const targetRows = await tx
				.select({ role: memberships.role })
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, targetUserId),
						eq(memberships.networkId, networkId),
					),
				);
			if (targetRows.length === 0) return { error: "not_found" as const };

			if (can(targetRows[0].role, "manage_members")) {
				const managers = await countManagers(networkId, tx);
				if (managers <= 1) {
					return { error: "last_owner" as const };
				}
			}

			await tx
				.delete(memberships)
				.where(
					and(
						eq(memberships.userId, targetUserId),
						eq(memberships.networkId, networkId),
					),
				);
			return { error: null };
		});
		if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.error === "last_owner") return c.json({ error: "last_owner" }, 409);
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

		// Check + mutation run inside a single transaction holding a per-network
		// advisory lock (withNetworkMemberLock) — otherwise two concurrent
		// demote requests against the last two managers could both pass the
		// countManagers check before either updates, leaving zero managers.
		const result = await withNetworkMemberLock(networkId, async (tx) => {
			const targetRows = await tx
				.select({ role: memberships.role })
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, targetUserId),
						eq(memberships.networkId, networkId),
					),
				);
			if (targetRows.length === 0) return { error: "not_found" as const };

			// Demoting a manage_members-capable member to a role without it — guard
			// against removing the last one.
			const wasManager = can(targetRows[0].role, "manage_members");
			const willBeManager = can(newRole, "manage_members");
			if (wasManager && !willBeManager) {
				const managers = await countManagers(networkId, tx);
				if (managers <= 1) {
					return { error: "last_owner" as const };
				}
			}

			await tx
				.update(memberships)
				.set({ role: newRole })
				.where(
					and(
						eq(memberships.userId, targetUserId),
						eq(memberships.networkId, networkId),
					),
				);
			return { error: null };
		});
		if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.error === "last_owner") return c.json({ error: "last_owner" }, 409);
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
		if (
			body.maxUses !== undefined &&
			body.maxUses !== null &&
			!(typeof body.maxUses === "number" && Number.isInteger(body.maxUses) && body.maxUses >= 1)
		) {
			return c.json({ error: "invalid_input" }, 422);
		}
		if (
			body.expiresInDays !== undefined &&
			body.expiresInDays !== null &&
			!(typeof body.expiresInDays === "number" && Number.isInteger(body.expiresInDays) && body.expiresInDays >= 1)
		) {
			return c.json({ error: "invalid_input" }, 422);
		}
		const maxUses = typeof body.maxUses === "number" ? body.maxUses : null;
		const expiresInDays = typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;

		const invite = await createInvite({
			networkId,
			createdBy: userId,
			email,
			maxUses,
			expiresInDays,
		});
		const url = `${EDITOR_URL}/invite?code=${invite.code}`;

		if (email) {
			const [network] = await db
				.select({ name: networks.name })
				.from(networks)
				.where(eq(networks.id, networkId));
			const [inviter] = await db
				.select({ name: users.name, email: users.email })
				.from(users)
				.where(eq(users.id, userId));
			sendSafely(
				inviteEmail({
					to: email,
					networkName: network?.name ?? "Artisan",
					inviterName: inviter?.name || inviter?.email || "A teammate",
					url,
				}),
			);
		}

		return c.json(
			{
				invite: {
					id: invite.id,
					code: invite.code,
					url,
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

// POST /api/networks/:idOrSlug/access-requests — any authenticated user, no
// membership required (the requester is by definition not a member yet).
// Resolves id OR slug like GET /:id, but deliberately skips requireMember —
// this endpoint IS the door for non-members. Fires an email to every
// owner/admin of the network on success (fire-and-forget, never blocks).
userNetworksRouter.post(
	"/:idOrSlug/access-requests",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);

		const param = c.req.param("idOrSlug");
		const netRows = await db
			.select()
			.from(networks)
			.where(or(eq(networks.id, param), eq(networks.slug, param)));
		if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
		const network = netRows[0];

		const existingMembership = await db
			.select({ userId: memberships.userId })
			.from(memberships)
			.where(
				and(eq(memberships.userId, userId), eq(memberships.networkId, network.id)),
			);
		if (existingMembership.length > 0) {
			return c.json({ error: "already_member" }, 409);
		}

		let body: { message?: unknown } = {};
		try {
			body = await c.req.json();
		} catch {
			/* empty body ok — message optional */
		}
		let message: string | null = null;
		if (body.message !== undefined && body.message !== null) {
			if (typeof body.message !== "string" || body.message.length > 500) {
				return c.json({ error: "invalid_message" }, 422);
			}
			message = body.message.trim() || null;
		}

		const result = await createRequest({ networkId: network.id, userId, message });
		if ("error" in result) {
			return c.json({ error: result.error }, 409);
		}

		const [requester] = await db
			.select({ name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, userId));
		const managers = await db
			.select({ email: users.email, role: memberships.role })
			.from(memberships)
			.innerJoin(users, eq(users.id, memberships.userId))
			.where(eq(memberships.networkId, network.id));
		const url = `${EDITOR_URL}/networks/${network.slug ?? network.id}`;
		for (const manager of managers) {
			if (!can(manager.role, "manage_members")) continue;
			sendSafely(
				accessRequestEmail({
					to: manager.email,
					networkName: network.name,
					requesterName: requester?.name || requester?.email || "A user",
					requesterEmail: requester?.email ?? "",
					message,
					url,
				}),
			);
		}

		return c.json({ request: { id: result.id, status: result.status } }, 201);
	},
);

// GET /api/networks/:id/access-requests — manage_members only.
userNetworksRouter.get(
	"/:id/access-requests",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const list = await listRequests(networkId);
		const requesterIds = list.map((r) => r.userId);
		const requesterRows = requesterIds.length
			? await db
					.select({ id: users.id, email: users.email, name: users.name })
					.from(users)
					.where(inArray(users.id, requesterIds))
			: [];
		const requesterById = new Map(requesterRows.map((u) => [u.id, u]));

		return c.json({
			requests: list.map((r) => {
				const requester = requesterById.get(r.userId);
				return {
					id: r.id,
					userId: r.userId,
					email: requester?.email ?? null,
					displayName: requester?.name ?? null,
					message: r.message,
					status: r.status,
					createdAt: r.createdAt.toISOString(),
				};
			}),
		});
	},
);

// POST /api/networks/:id/access-requests/:requestId/approve — manage_members only.
userNetworksRouter.post(
	"/:id/access-requests/:requestId/approve",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const requestId = c.req.param("requestId");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const rows = await db
			.select({ id: networkAccessRequests.id })
			.from(networkAccessRequests)
			.where(
				and(
					eq(networkAccessRequests.id, requestId),
					eq(networkAccessRequests.networkId, networkId),
				),
			);
		if (rows.length === 0) return c.json({ error: "not_found" }, 404);

		const result = await resolveRequest(requestId, { approve: true, resolvedBy: userId });
		if ("error" in result) return c.json({ error: result.error }, 409);
		return c.json({ status: result.status });
	},
);

// POST /api/networks/:id/access-requests/:requestId/deny — manage_members only.
userNetworksRouter.post(
	"/:id/access-requests/:requestId/deny",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const requestId = c.req.param("requestId");
		try {
			await requireCapability(userId, networkId, "manage_members");
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const rows = await db
			.select({ id: networkAccessRequests.id })
			.from(networkAccessRequests)
			.where(
				and(
					eq(networkAccessRequests.id, requestId),
					eq(networkAccessRequests.networkId, networkId),
				),
			);
		if (rows.length === 0) return c.json({ error: "not_found" }, 404);

		const result = await resolveRequest(requestId, { approve: false, resolvedBy: userId });
		if ("error" in result) return c.json({ error: result.error }, 409);
		return c.json({ status: result.status });
	},
);
