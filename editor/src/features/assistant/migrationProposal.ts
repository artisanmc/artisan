import { visitMenuLTexts } from "@/domain/i18nSites";
import { projectId as toProjectId } from "@/domain/ids";
import type { I18nKey, Menu, Project } from "@/domain/types";
import { serializeMenuToV1 } from "@/features/export/transform";
import { menuV1ToDomain } from "@/schema/menuV1ToDomain";
import { validateMenuV1 } from "@/schema/validateMenuV1";
import { useAccountStore } from "@/state/accountStore";

export interface MigrationProposalInput {
  id: string;
  stepId: string;
  targetId: string;
  baseHash: string | null;
  resultHash: string;
  menu: Record<string, unknown>;
  translations?: unknown[];
}

export type MigrationProposalInspection = {
  status: "available" | "already_applied" | "conflict" | "blocked";
  code?: string;
  unsupported?: string[];
};
export type MigrationProposalApplication =
  | MigrationProposalInspection
  | { status: "applied"; storageAvailable: boolean };

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  throw new Error("invalid_proposal");
}

/** Canonical key sites erase random imported keys, not their translations or semantics. */
function projection(menu: Menu, project: Project, translations = project.i18nKeys): string {
  const copy = structuredClone(menu);
  const values: Record<string, Record<string, string>> = {};
  for (const site of visitMenuLTexts(copy)) {
    values[site.key] = { ...(translations[site.lText.key] ?? {}) };
    site.lText.key = site.key;
  }
  const scratch: Project = {
    ...project,
    menus: [copy],
    i18nKeys: values as Project["i18nKeys"],
    i18nMode: "extract",
  };
  return canonical(
    JSON.parse(JSON.stringify({ menu: serializeMenuToV1(copy, scratch), translations: values })),
  );
}

function inspect(proposal: MigrationProposalInput, projectId: string): MigrationProposalInspection {
  const project = useAccountStore
    .getState()
    .account.projects.find((candidate) => candidate.id === projectId);
  if (!project) return { status: "blocked", code: "project_unavailable" };
  if (proposal.baseHash !== null || proposal.translations?.length)
    return { status: "blocked", code: "unsupported_proposal" };
  const droppedFields = ["open_actions", "close_actions", "open_requirements", "background"].filter(
    (key) => proposal.menu[key] !== undefined,
  );
  if (droppedFields.length)
    return { status: "blocked", code: "unsupported_proposal", unsupported: droppedFields };
  if (
    proposal.menu.id !== proposal.targetId ||
    !/^[a-f0-9]{64}$/.test(proposal.resultHash) ||
    !validateMenuV1(proposal.menu).valid
  )
    return { status: "blocked", code: "invalid_proposal" };
  const converted = menuV1ToDomain(proposal.menu, {
    projectId: project.id,
    lang: project.defaultLang,
  });
  if (converted.unsupported.length)
    return { status: "blocked", code: "unsupported_proposal", unsupported: converted.unsupported };
  const expected = projection(
    converted.menu,
    project,
    converted.i18nKeys as Record<I18nKey, Record<string, string>>,
  );
  const current = project.menus.find((candidate) => candidate.id === proposal.targetId);
  if (!current) return { status: "available" };
  return { status: projection(current, project) === expected ? "already_applied" : "conflict" };
}

/** Display-only comparison; apply always verifies the cryptographic result hash again. */
export function inspectMigrationProposal(
  proposal: MigrationProposalInput,
  projectId: string,
): MigrationProposalInspection {
  try {
    if (new TextEncoder().encode(canonical(proposal.menu)).length > 1024 * 1024)
      return { status: "blocked", code: "proposal_too_large" };
    return inspect(proposal, projectId);
  } catch {
    return { status: "blocked", code: "invalid_proposal" };
  }
}

export function canPersistMigrationDraft(): boolean {
  try {
    const key = `artisan.migration.storage-probe.${crypto.randomUUID()}`;
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export async function applyMigrationProposal(
  proposal: MigrationProposalInput,
  projectId: string,
  options: { isCurrent?: () => boolean } = {},
): Promise<MigrationProposalApplication> {
  try {
    const snapshot = structuredClone(proposal);
    const bytes = new TextEncoder().encode(canonical(snapshot.menu));
    if (bytes.length > 1024 * 1024) return { status: "blocked", code: "proposal_too_large" };
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== snapshot.resultHash) return { status: "blocked", code: "invalid_proposal_hash" };
    if (options.isCurrent && !options.isCurrent())
      return { status: "blocked", code: "scope_changed" };
    // No awaits between the latest-state comparison and the synchronous store transaction.
    const current = inspect(snapshot, projectId);
    if (current.status !== "available") return current;
    const project = useAccountStore
      .getState()
      .account.projects.find((candidate) => candidate.id === projectId);
    if (!project) return { status: "blocked", code: "project_unavailable" };
    useAccountStore.getState().applyAssistantMenu({
      projectId: toProjectId(projectId),
      menuV1: snapshot.menu,
      lang: project.defaultLang,
    });
    return { status: "applied", storageAvailable: canPersistMigrationDraft() };
  } catch {
    return { status: "blocked", code: "invalid_proposal" };
  }
}
