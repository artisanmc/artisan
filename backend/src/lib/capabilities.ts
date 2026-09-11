// backend/src/lib/capabilities.ts
//
// Capability layer on top of membership roles. `Role` is the single source
// of truth for the type — membershipGuard.ts and membershipManager.ts
// import/re-export it rather than re-declaring it.

export type Role = "owner" | "admin" | "member"; // admin = legacy, treated as owner

export type Capability =
	| "publish_content" // separate from draft editing for future delegated clients
	| "edit_content" // project/deploy/asset editing — implicit via requireMember without a role
	| "manage_servers" // rotate/delete/edit server keys, allowlist, helloes
	| "manage_members" // invites + member management
	| "manage_billing"
	| "manage_network" // network identity/governance (rename, slug) — not member-grantable
	| "transfer_network"
	| "delete_network";

const ALL_CAPS: Capability[] = [
	"publish_content",
	"edit_content",
	"manage_servers",
	"manage_members",
	"manage_billing",
	"manage_network",
	"transfer_network",
	"delete_network",
];

const GRANTS: Record<string, Set<Capability>> = {
	owner: new Set(ALL_CAPS),
	// Deprecated: "admin" is a legacy alias for "owner" — kept for backward
	// compatibility with existing memberships, grants everything for now.
	admin: new Set(ALL_CAPS),
	member: new Set<Capability>(["edit_content", "publish_content"]),
};

export function can(role: string, cap: Capability): boolean {
	return GRANTS[role]?.has(cap) ?? false;
}
