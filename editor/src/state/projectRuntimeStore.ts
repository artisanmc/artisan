import type { UserProjectLoadResult } from "@/lib/api/userProjects";
import { create } from "zustand";

export interface ProjectRuntime {
  projectId: string;
  networkId: string | null;
  serverId: string | null;
  minecraftVersion: string | null;
  capabilities: {
    canUseAssistant?: boolean;
    canImport?: boolean;
    canDelete?: boolean;
    canRename: boolean;
    canCopyToServer?: boolean;
    liveData: boolean;
    captureInGame: boolean;
    preview: boolean;
  };
  connection: { available: boolean };
}
export const unavailableProjectCapabilities = Object.freeze({
  canUseAssistant: false,
  canImport: false,
  canDelete: false,
  canCopyToServer: false,
  canRename: false,
  liveData: false,
  captureInGame: false,
  preview: true,
});
export function projectRuntime(metadata: UserProjectLoadResult): ProjectRuntime {
  const serverId = metadata.project.serverKeyId ?? metadata.serverKeyId ?? null;
  return {
    projectId: metadata.project.id,
    networkId: metadata.networkId,
    serverId,
    minecraftVersion: metadata.minecraftVersion ?? null,
    capabilities: {
      canUseAssistant: true,
      canImport: true,
      canDelete: true,
      canCopyToServer: false,
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
