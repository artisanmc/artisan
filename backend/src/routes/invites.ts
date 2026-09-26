// backend/src/routes/invites.ts
// Public invite preview + accept, mounted at /api/v1/invites.
// GET /:code needs no auth (preview page in the editor before login/signup).
// POST /:code/accept needs the user cookie (userAuth applied in app.ts).

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { acceptInvite, getInviteByCode, inviteStatus } from "../lib/inviteStorage";
import { PlanLimitError } from "../modules/billing/planLimits";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const invitesRouter = new Hono<{ Variables: Vars }>();

// GET /api/v1/invites/:code — no auth. Lets the editor render a preview
// ("You're invited to join <network> as <role>") before the user logs in.
invitesRouter.get("/:code", async (c: Context<{ Variables: Vars }>) => {
	const code = c.req.param("code");
	const invite = await getInviteByCode(code);
	if (!invite) return c.json({ error: "not_found" }, 404);

	const netRows = await db
		.select({ name: networks.name })
		.from(networks)
		.where(eq(networks.id, invite.networkId));

	return c.json({
		status: inviteStatus(invite),
		network_name: netRows[0]?.name ?? null,
		role: invite.role,
	});
});

// POST /api/v1/invites/:code/accept — requires the user session cookie.
invitesRouter.post(
	"/:code/accept",
	async (c: Context<{ Variables: Vars }>) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const code = c.req.param("code");

		const result = await acceptInvite(code, user.id).catch((error) => {
			if (error instanceof PlanLimitError) return { error: error.code } as const;
			throw error;
		});
		if ("error" in result) {
			if (result.error === "collaborator_limit_reached") return c.json({ error: result.error }, 409);
			if (result.error === "not_found") {
				return c.json({ error: "not_found" }, 404);
			}
			// revoked | expired | exhausted — all "no longer usable".
			return c.json({ error: result.error }, 410);
		}

		return c.json({
			network_id: result.networkId,
			already_member: result.alreadyMember,
		});
	},
);
