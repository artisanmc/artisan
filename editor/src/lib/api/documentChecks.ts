import { apiFetch } from "./client";

/** One reason a file would not load on the server: `layout`, `yaml`, `schema`, `actions` or `engine`. */
export interface DocumentProblem {
  path: string;
  stage: string;
  message: string;
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
): Promise<DocumentProblem[]> {
  const meta = (path: string) => path.split("/")[0]!.startsWith(".artisan");
  const body = await apiFetch<{ problems?: DocumentProblem[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/check`,
    {
      method: "POST",
      json: {
        files: Object.entries(files)
          .filter(([path]) => !meta(path))
          .map(([path, content]) => ({ path, content })),
        deletes: deletes.filter((path) => !meta(path)),
      },
      timeoutMs: 30_000,
    },
  );
  return body.problems ?? [];
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
