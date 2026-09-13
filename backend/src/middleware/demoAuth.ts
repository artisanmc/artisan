import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {HTTPException} from 'hono/http-exception';
import { getDemoSessionProof, readDemoSession } from "../lib/demoSessions";
import type { ProjectPrincipal } from "../lib/projectPrincipal";

export const DEMO_COOKIE = "artisan_demo_session";
export const DEMO_CSRF_HEADER = "X-Artisan-Demo-CSRF";
export const DEMO_EXPIRY_HEADER = "X-Artisan-Demo-Expires-At";
export function demoErrorResponse(c: Context, error: unknown) {
 if(error instanceof HTTPException)return c.json({error:error.status===413?'request_too_large':'invalid_request'},error.status);
	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
	const statuses: Record<string, number> = {
		demo_expired: 410,
		claim_pending: 409,
		demo_quota_exceeded: 413,
		demo_capacity_exceeded: 429,
		demo_rate_limited: 429,
		forbidden: 403,
		unauthorized: 401,
	};
	if (statuses[code]) return c.json({ error: code }, statuses[code] as 403);
	console.error("[project] storage request failed", error);
	return c.json({ error: "storage_unavailable" }, 503);
}
export const demoOriginAllowed = (c: Context) =>
	c.req.header("Origin") ===
	(process.env.EDITOR_URL ?? "http://localhost:5173");
export function setDemoCookie(c: Context, token: string, expiresAt: string) {
	setCookie(c, DEMO_COOKIE, token, {
		httpOnly: true,
		sameSite: "Lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		expires: new Date(expiresAt),
	});
}
const fail = (code: string, status: number): never => {
	throw Object.assign(new Error(code), { code, status });
};
/** Select the temporary principal only for its exact project, including after OAuth. */
export async function requestProjectPrincipal(
	c: Context,
	projectId: string,
	deps = { read: readDemoSession, proof: getDemoSessionProof },
): Promise<ProjectPrincipal> {
	const token = getCookie(c, DEMO_COOKIE);
	if (token) {
		const session = await deps.read(token);
		if (session?.projectId === projectId) {
			if (
				!["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
				(!demoOriginAllowed(c) ||
					c.req.header(DEMO_CSRF_HEADER) !== session.csrfToken)
			)
				fail("forbidden", 403);
			return session.principal;
		}
		if (!session) {
			const proof = await deps.proof(token);
			if (proof?.projectId === projectId) {
				const account = c.get("user") as { id: string } | null;
				if (proof.state === "claimed" && account) return account.id;
				fail(
					proof.state === "claiming"
						? "claim_pending"
						: proof.state === "claimed"
							? "forbidden"
							: "demo_expired",
					proof.state === "claiming"
						? 409
						: proof.state === "claimed"
							? 403
							: 410,
				);
			}
		}
	}
	const user = c.get("user") as { id: string } | null;
	if (user) return user.id;
	return fail(token ? "forbidden" : "unauthorized", token ? 403 : 401);
}
/** Successful effective writes extend the cookie to the storage-confirmed expiry. */
export async function refreshDemoResponse(
	c: Context,
	next: () => Promise<void>,
) {
	await next();
	if (c.res.status >= 400 || ["GET", "HEAD", "OPTIONS"].includes(c.req.method))
		return;
	const token = getCookie(c, DEMO_COOKIE);
	if (!token) return;
	const session = await readDemoSession(token);
	if (!session) return;
	if (!c.req.path.includes(`/${session.projectId}/`)) return;
	c.header(DEMO_EXPIRY_HEADER, session.expiresAt);
	setDemoCookie(c, token, session.expiresAt);
}
