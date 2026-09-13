import type { Capability } from "./capabilities";
import { requireCapability, requireMember } from "./membershipGuard";
import type { Project } from "./projectStorage";
import { authorizeDemoProject } from "./demoSessions";

export interface GuestPrincipal {
	kind: "guest";
	id: string;
	projectId: string;
}
export type ProjectPrincipal = string | GuestPrincipal;
export const principalOwnerId = (principal: ProjectPrincipal) =>
	typeof principal === "string" ? principal : principal.id;
export async function authorizeProjectPrincipal(
	principal: ProjectPrincipal,
	project: Project,
	capability?: Capability,
) {
	if (typeof principal !== "string") {
		if (
			capability &&
			capability !== "edit_content" &&
			capability !== "publish_content"
		)
			throw Object.assign(new Error("forbidden"), { code: "forbidden" });
		await authorizeDemoProject(principal, project.id);
		return;
	}
	if (!project.networkId || project.demoSessionId)
		throw Object.assign(new Error("forbidden"), { code: "forbidden" });
	if (capability)
		await requireCapability(principal, project.networkId, capability);
	else await requireMember(principal, project.networkId);
}
