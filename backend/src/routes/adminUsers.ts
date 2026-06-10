import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { memberships, networks, users } from "../db/schema";

// Mounted on /api/v1/admin (app.ts), behind userAuth() + requireAdmin().

type UserRow = typeof users.$inferSelect;

/** Public DTO — never leaks passwordHash, only its presence. */
function toDto(u: UserRow) {
	return {
		id: u.id,
		email: u.email,
		name: u.name,
		avatarUrl: u.avatarUrl,
		editorLanguage: u.editorLanguage,
		theme: u.theme,
		isAdmin: u.isAdmin,
		hasPassword: u.passwordHash != null,
		createdAt: u.createdAt,
		updatedAt: u.updatedAt,
	};
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function buildAdminUsersRouter(): Hono {
	const r = new Hono();

	// List + search (name/email, case-insensitive). Newest accounts first.
	r.get("/users", async (c) => {
		const q = (c.req.query("q") ?? "").trim();
		const limit = Math.min(
			Number.parseInt(c.req.query("limit") ?? "50", 10) || 50,
			200,
		);
		const rows = await db
			.select()
			.from(users)
			.where(
				q
					? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))
					: undefined,
			)
			.orderBy(desc(users.createdAt))
			.limit(limit);
		return c.json({ users: rows.map(toDto) });
	});

	// One user's profile + the networks they belong to (with their role).
	r.get("/users/:id", async (c) => {
		const [u] = await db
			.select()
			.from(users)
			.where(eq(users.id, c.req.param("id")));
		if (!u) return c.json({ error: "not_found" }, 404);
		const nets = await db
			.select({
				id: networks.id,
				name: networks.name,
				slug: networks.slug,
				role: memberships.role,
			})
			.from(memberships)
			.innerJoin(networks, eq(memberships.networkId, networks.id))
			.where(eq(memberships.userId, u.id));
		return c.json({ ...toDto(u), networks: nets });
	});

	// Edit name / email / isAdmin. Email is normalized (trim + lowercase) and
	// must stay unique; an admin cannot strip their own admin flag (lockout).
	r.patch("/users/:id", async (c) => {
		const id = c.req.param("id");
		const [u] = await db.select().from(users).where(eq(users.id, id));
		if (!u) return c.json({ error: "not_found" }, 404);
		const body = await c.req
			.json()
			.catch(() => ({}) as Record<string, unknown>);

		const patch: Partial<typeof users.$inferInsert> = {};

		if (body.name !== undefined) {
			const name = typeof body.name === "string" ? body.name.trim() : "";
			if (!name) return c.json({ error: "invalid_name" }, 422);
			patch.name = name;
		}

		if (body.email !== undefined) {
			const email =
				typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
			if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 422);
			const [taken] = await db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.email, email), ne(users.id, id)));
			if (taken) return c.json({ error: "email_taken" }, 409);
			patch.email = email;
		}

		if (body.isAdmin !== undefined) {
			const isAdmin = body.isAdmin === true;
			if (!isAdmin && c.get("user")?.id === id)
				return c.json({ error: "cannot_demote_self" }, 422);
			patch.isAdmin = isAdmin;
		}

		if (Object.keys(patch).length === 0) return c.json(toDto(u));
		const [updated] = await db
			.update(users)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(users.id, id))
			.returning();
		return c.json(toDto(updated as UserRow));
	});

	return r;
}
