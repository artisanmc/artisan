import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "hono/bun";
import { getCookie } from "hono/cookie";
import {HTTPException} from 'hono/http-exception';
import {
	claimDemoSession,
	createDemoSession,
	getDemoSessionProof,
	readDemoSession,
	resumeOwnedDemoClaim,
} from "../lib/demoSessions";
import {
	DEMO_COOKIE,
	DEMO_CSRF_HEADER,
	demoOriginAllowed,
	setDemoCookie,
} from "../middleware/demoAuth";
import type { AuthUser } from "../middleware/userAuth";

type Dependencies = {
	read: typeof readDemoSession;
	create: typeof createDemoSession;
	proof: (
		token: string,
	) => Promise<{ csrfToken: string; projectId: string; state?: string } | null>;
	claim: typeof claimDemoSession;
	resume?: typeof resumeOwnedDemoClaim;
	rateKey: (c: Context) => string;
};
const defaults: Dependencies = {
	read: readDemoSession,
	create: createDemoSession,
	proof: getDemoSessionProof,
	claim: claimDemoSession,
	resume: resumeOwnedDemoClaim,
	rateKey: (c) => {
		try {
			return getConnInfo(c).remote.address ?? "unknown";
		} catch {
			return "unknown";
		}
	},
};
export function createDemoRouter(deps: Dependencies = defaults) {
	const router = new Hono<{ Variables: { user: AuthUser | null } }>();
	router.use("*", bodyLimit({ maxSize: 2048 }));
	router.onError((error, c) => {
  if(error instanceof HTTPException)return c.json({error:error.status===413?'request_too_large':'invalid_request'},error.status);
		const candidate = "code" in error ? String(error.code) : "";
		const statuses: Record<string, number> = {
			forbidden: 403,
			demo_rate_limited: 429,
			demo_capacity_exceeded: 429,
			demo_expired: 410,
			invalid_input: 422,
			not_found: 404,
			claim_pending: 409,
			claim_target_unavailable: 409,
			operation_superseded: 409,
			operation_mismatch: 409,
			demo_quota_exceeded: 413,
			demo_unavailable: 503,
		};
		if (!statuses[candidate]) {
			console.error("[demo] request failed", error);
			return c.json({ error: "storage_unavailable" }, 503);
		}
		return c.json({ error: candidate }, statuses[candidate] as 403);
	});
	const publicBody = (s: Awaited<ReturnType<typeof createDemoSession>>) => ({
		projectId: s.projectId,
		expiresAt: s.expiresAt,
		csrfToken: s.csrfToken,
		principal: s.principal,
	});
	router.get("/", async (c) => {
		const token = getCookie(c, DEMO_COOKIE);
		const s = token ? await deps.read(token) : null;
		if (!s) {
			const proof = token ? await deps.proof(token) : null;
			if (proof && ["active", "expired"].includes(proof.state ?? ""))
				return c.json({ error: "demo_expired" }, 410);
			return c.json({ error: "not_found" }, 404);
		}
		c.header("Cache-Control", "private, no-store");
		return c.json(publicBody(s));
	});
	router.post("/", async (c) => {
		if (!demoOriginAllowed(c)) return c.json({ error: "forbidden" }, 403);
		const s = await deps.create(
			{ rateKey: deps.rateKey(c) },
			getCookie(c, DEMO_COOKIE),
		);
		setDemoCookie(c, s.token, s.expiresAt);
		c.header("Cache-Control", "private, no-store");
		return c.json(publicBody(s), 201);
	});
	return router;
}
export const demoRouter = createDemoRouter();
