import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { validateAccessToken } from "./auth";
import { findSession } from "./sessionManager";

/**
 * Dual-auth tenant key shared by the assistant and ai routes: editor-session
 * Bearer token (`sk:<serverKeyId>`) or user-session cookie (`user:<userId>`).
 */
export async function resolveOwnerKey(c: Context): Promise<string | null> {
	const h = c.req.header("Authorization");
	const bearer = h?.startsWith("Bearer ") ? h.slice(7) : "";
	if (bearer) {
		const session = await validateAccessToken(bearer);
		if (session) return `sk:${session.serverKeyId}`;
	}
	const sessionId = getCookie(c, "artisan_user_session");
	if (sessionId) {
		const us = await findSession(sessionId);
		if (us) return `user:${us.userId}`;
	}
	return null;
}
