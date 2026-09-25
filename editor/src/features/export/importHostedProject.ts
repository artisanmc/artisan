import { planWrite } from "@/features/project/diskSave";
import { createHostedProject, listHostedProjects } from "@/lib/api/hostedProjects";
import { hashContent } from "@/lib/contentHash";
import {
  IMPORT_RECOVERY_PREFIX,
  importRecovery,
  importRecoveryGeneration,
} from "@/lib/importRecovery";
import { projectClient } from "@/lib/projectClient";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { parse } from "yaml";
import { normalizeProjectFiles, readProjectZip } from "./projectZip";
import type { ImportProjectResult } from "./runImportZip";

type Batch = Parameters<ReturnType<typeof projectClient>["write"]>[0];
type PendingImport = { operationId: string; projectId?: string; batch?: Batch; at: number };
const pending = importRecovery as Map<string, PendingImport>;
const PREFIX = IMPORT_RECOVERY_PREFIX;

function retain(key: string, value: PendingImport) {
  pending.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The open page retains retries when browser storage is full. */
  }
}

/** Le backend n'accepte que `[a-zA-Z0-9_-]` dans un operationId. */
const filesOperation = (operationId: string) => `${operationId}-files`;

/** Imports a portable archive as one mixed transaction, with a frozen recovery request. */
export async function importHostedProject(
  file: Blob,
  networkId: string,
  minecraftVersion: string,
  ownerId: string,
  targetId?: string,
  options: { overwrite?: boolean } = {},
): Promise<ImportProjectResult> {
  const generation = importRecoveryGeneration();
  const assertPrincipal = () => {
    if (projectPrincipal.current()?.id !== ownerId || importRecoveryGeneration() !== generation)
      throw new Error("session_changed");
  };
  assertPrincipal();
  const normalized = normalizeProjectFiles(await readProjectZip(file), targetId);
  assertPrincipal();
  const prefix = `plugins/Artisan/projects/${normalized.projectId}/`;
  const text: Record<string, string> = {};
  const binary: Record<string, string> = {};
  for (const [path, content] of Object.entries(normalized.files)) {
    const relative = path.slice(prefix.length);
    if (typeof content === "string") text[relative] = content;
    else {
      let encoded = "";
      for (const byte of content) encoded += String.fromCharCode(byte);
      binary[relative] = btoa(encoded);
    }
  }
  const name = String(parse(text["manifest.yaml"] ?? "")?.name ?? normalized.projectId);
  const digest = await hashContent(
    JSON.stringify({ text, binary, folder: normalized.projectId, minecraftVersion }),
  );
  const key = `${PREFIX}${ownerId}:${networkId}:${digest}`;
  /** Crée le project ; si son dossier est déjà pris et qu'on a choisi d'écraser, reprend l'existant. */
  const createOrReuse = async (): Promise<string> => {
    try {
      const project = await createHostedProject(networkId, {
        operationId: recovery!.operationId,
        name,
        folderName: normalized.projectId,
        minecraftVersion,
        templateId: "vanilla",
      });
      return project.id;
    } catch (error) {
      if (!options.overwrite || !(error instanceof Error) || error.message !== "destination_exists")
        throw error;
      const existing = (await listHostedProjects(networkId)).find(
        (p) => (p.externalId ?? p.id) === normalized.projectId,
      );
      if (!existing) throw error;
      return existing.id;
    }
  };
  assertPrincipal();
  let recovery = pending.get(key);
  if (!recovery) {
    try {
      recovery = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? undefined;
    } catch {
      /* Invalid recovery is ignored. */
    }
  }
  if (!recovery || recovery.at < Date.now() - 86_400_000)
    recovery = { operationId: crypto.randomUUID(), at: Date.now() };
  retain(key, recovery);
  if (!recovery.projectId) {
    recovery.projectId = await createOrReuse();
    assertPrincipal();
    retain(key, recovery);
  }
  const client = projectClient(recovery.projectId);
  if (!recovery.batch) {
    const baseline = await client.read();
    assertPrincipal();
    if (!baseline.ok) throw new Error(baseline.error);
    if (baseline.unchanged) throw new Error("missing_import_baseline");
    const binaries = Object.entries(binary).map(([path, content_base64]) => ({
      path,
      content_base64: content_base64 as string | null,
      base_hash: baseline.binaries?.find((entry) => entry.path === path)?.hash ?? null,
    }));
    for (const entry of baseline.binaries ?? []) {
      if (!(entry.path in binary))
        binaries.push({ path: entry.path, content_base64: null, base_hash: entry.hash });
    }
    recovery.batch = {
      ...(await planWrite(baseline.files, text)),
      renames: [],
      binaries,
      operationId: filesOperation(recovery.operationId),
    };
    assertPrincipal();
    retain(key, recovery);
  }
  // L'id est recalculé à l'envoi : un lot repris d'une ancienne tentative
  // portait « :files », que le backend refuse.
  const result = await client.write({
    ...recovery.batch,
    operationId: filesOperation(recovery.operationId),
  });
  assertPrincipal();
  if (!result.ok) throw new Error(result.error);
  pending.delete(key);
  sessionStorage.removeItem(key);
  return { newId: recovery.projectId, urlId: normalized.projectId, name };
}
