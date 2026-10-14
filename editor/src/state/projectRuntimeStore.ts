import type { UserProjectLoadResult } from "@/lib/api/userProjects";
import { create } from "zustand";

export interface ProjectRuntime {
  projectId: string;
  serverId: string | null;
  minecraftVersion: string | null;
  capabilities: {
    canImport?: boolean;
    canDelete?: boolean;
    canRename: boolean;
    liveData: boolean;
    captureInGame: boolean;
    preview: boolean;
  };
  connection: { available: boolean };
}
export const unavailableProjectCapabilities = Object.freeze({
  canImport: false,
  canDelete: false,
  canRename: false,
  liveData: false,
  captureInGame: false,
  preview: true,
});
export function projectRuntime(metadata: UserProjectLoadResult): ProjectRuntime {
  const serverId = metadata.project.serverKeyId ?? metadata.serverKeyId ?? null;
  return {
    projectId: metadata.project.id,
    serverId,
    minecraftVersion: metadata.minecraftVersion ?? null,
    capabilities: {
      canImport: true,
      canDelete: true,
      ...(metadata.capabilities ?? {
        canRename: false,
        liveData: serverId !== null,
        captureInGame: serverId !== null,
        preview: true,
      }),
    },
    connection: metadata.connection ?? { available: true },
  };
}
export const useProjectRuntimeStore = create<{
  current: ProjectRuntime | null;
  set: (runtime: ProjectRuntime | null) => void;
}>((set) => ({ current: null, set: (current) => set({ current }) }));
export function useProjectRuntime(projectId?: string) {
  return useProjectRuntimeStore((state) =>
    state.current?.projectId === projectId ? state.current : null,
  );
}
