import { apiFetch } from "./client";

/**
 * One reason a file would not load on the server: `layout`, `yaml`, `schema`, `actions`,
 * `engine` or `module` (the module that owns the file's kind refuses it).
 */
export interface DocumentProblem {
  path: string;
  stage: string;
  message: string;
}

/**
 * What deploying a file does to the players already in the game, said by the module that owns
 * its kind (a quest's progress lost, players moved on…). `loss`: players lose something, the
 * author confirms before deploying. `unassessed`: the module's check failed.
 */
export interface DocumentImpact {
  path: string;
  level: "loss" | "notice" | "unassessed";
  message: string;
}

/** The server's answer to `documents_check`. */
export interface DocumentVerdict {
  problems: DocumentProblem[];
  impacts: DocumentImpact[];
}

/**
 * Would these files load on the Project's server? The check Deploy runs before writing
 * (`documents_check`), asked ahead of the click. Nothing is written. `.artisan*` metadata is
 * the editor's, never checked: it is left out here.
 */
export async function checkDocuments(
  projectId: string,
  files: Record<string, string>,
  deletes: string[],
  lang = "en",
): Promise<DocumentVerdict> {
  const meta = (path: string) => path.split("/")[0]!.startsWith(".artisan");
  const body = await apiFetch<{ problems?: DocumentProblem[]; impacts?: DocumentImpact[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/check`,
    {
      method: "POST",
      json: {
        files: Object.entries(files)
          .filter(([path]) => !meta(path))
          .map(([path, content]) => ({ path, content })),
        deletes: deletes.filter((path) => !meta(path)),
        lang: lang.slice(0, 2).toLowerCase(),
      },
      timeoutMs: 30_000,
    },
  );
  return { problems: body.problems ?? [], impacts: body.impacts ?? [] };
}

/** The written files and the deleted paths of a deployment from `before` to `after`. */
export function deploymentDelta(
  before: Record<string, string>,
  after: Record<string, string>,
): { files: Record<string, string>; deletes: string[] } {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(after))
    if (before[path] !== content) files[path] = content;
  return { files, deletes: Object.keys(before).filter((path) => !(path in after)) };
}
