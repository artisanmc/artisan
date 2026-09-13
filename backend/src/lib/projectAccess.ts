import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, projects } from "../db/schema";

export type ProjectAccess =
	| { ok: true; networkId: string; serverKeyId: string | null }
	| { ok: false; error: "project_not_found" | "forbidden" };

/** Tenant guard shared by the ai and assistant routes: the `user:` session
 *  needs a membership on the project's network. */
export async function resolveProjectAccess(
	ownerKey: string,
	projectId: string,
): Promise<ProjectAccess> {
	if (!ownerKey.startsWith("user:") || ownerKey.length <= 5) return { ok: false, error: "forbidden" };
	const rows = await db
		.select({ networkId: projects.networkId, serverKeyId: projects.serverKeyId })
		.from(projects)
		.where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
	if (rows.length === 0) return { ok: false, error: "project_not_found" };
	const proj = rows[0];
	if(!proj.networkId)return {ok:false,error:'forbidden'};
	const member = await db
		.select({ id: memberships.id })
		.from(memberships)
		.where(
			and(
				eq(memberships.userId, ownerKey.slice(5)),
				eq(memberships.networkId, proj.networkId),
			),
		);
	if (member.length === 0) return { ok: false, error: "forbidden" };
	return { ok: true, networkId: proj.networkId, serverKeyId: proj.serverKeyId };
}
