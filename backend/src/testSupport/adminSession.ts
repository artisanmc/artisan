import { db } from "../db";
import { users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
export async function adminCookie() {
	const id = `test-admin-${crypto.randomUUID()}`;
	const now = new Date();
	await db.insert(users).values({
		id,
		email: `${id}@example.invalid`,
		name: "Test admin",
		isAdmin: true,
		createdAt: now,
		updatedAt: now,
	});
	return `artisan_user_session=${(await createSession(id)).id}`;
}
