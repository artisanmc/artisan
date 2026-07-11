import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { findSession } from "./sessionManager";

/**
 * Tenant key shared by the assistant and ai routes: user-session cookie
 * (`user:<userId>`). Accounts-only (the editor-session Bearer `sk:` variant
 * was removed in the accounts-only cutover, Task 7).
 */
export async function resolveOwnerKey(c: Context): Promise<string | null> {
	const sessionId = getCookie(c, "artisan_user_session");
	if (sessionId) {
		const us = await findSession(sessionId);
		if (us) return `user:${us.userId}`;
	}
	return null;
}
