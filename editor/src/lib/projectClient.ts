import { readFileHistory, readProjectFiles, writeProjectFiles } from "./api/projectFiles";
import { projectFetch } from "./projectFetch";

const API_URL = import.meta.env.VITE_API_URL ?? "";
/** Bound once to the immutable authorized identity; storage location stays behind HTTP. */
export function projectClient(projectId: string) {
  return {
    read: (hash?: string | null) => readProjectFiles(projectId, hash),
    write: (plan: Parameters<typeof writeProjectFiles>[1]) => writeProjectFiles(projectId, plan),
    history: (path: string) => readFileHistory(projectId, path),
    async binary(path: string): Promise<Uint8Array> {
      const response = await projectFetch(
        projectId,
        `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/binary?path=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("binary_read_failed");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
