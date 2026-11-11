import { projectDestination } from "@/lib/projectNavigation";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type WorkspaceViewTab, leavesChildPage, tabSearchValue } from "./workspaceTabs";

/** Is a page open under the module (a Document, a collection, a screen, a data source)? */
export function useChildPageOpen(): boolean {
  const { documentId, screenId, collectionDir, dataSourceId } = useParams({
    strict: false,
  }) as Record<string, string | undefined>;
  return !!(documentId || screenId || collectionDir || dataSourceId);
}

/**
 * Switches the workspace view (topbar nav, digit shortcuts). A secondary view covers the
 * page in place; the home and the board are the module's root, so from a child page they
 * go back to it.
 */
export function useGoToWorkspaceTab(): (tab: WorkspaceViewTab) => void {
  const navigate = useNavigate();
  const { serverId, projectId } = useParams({ strict: false }) as {
    serverId?: string;
    projectId?: string;
  };
  const childOpen = useChildPageOpen();
  return (tab) => {
    const value = tabSearchValue(tab);
    if (childOpen && leavesChildPage(tab) && projectId) {
      void navigate({
        ...projectDestination(projectId, serverId),
        search: value ? { tab: value } : {},
      } as never);
      return;
    }
    void navigate({
      to: ".",
      search: (prev) => ({ ...(prev as object), tab: value }) as never,
    });
  };
}
