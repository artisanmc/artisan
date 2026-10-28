import { ApiError, apiRequest } from "./api/client";
import { readFileHistory, readProjectFiles, writeProjectFiles } from "./api/projectFiles";

/** Bound once to the immutable authorized identity; storage location stays behind HTTP. */
export function projectClient(projectId: string) {
  return {
    read: (hash?: string | null) => readProjectFiles(projectId, hash),
    write: (plan: Parameters<typeof writeProjectFiles>[1]) => writeProjectFiles(projectId, plan),
    history: (path: string) => readFileHistory(projectId, path),
    async binary(path: string): Promise<Uint8Array> {
      const response = await apiRequest(
        `/api/v1/projects/${encodeURIComponent(projectId)}/binary?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) throw new ApiError("binary_read_failed", response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
