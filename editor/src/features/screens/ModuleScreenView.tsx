import type { DataSource, Project } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import type { ConfigScreenProps } from "@artisan/editor-sdk";
import type { ComponentType } from "react";

/**
 * A module's own view of a Config screen (`FrontendModule.screens`). It edits the same
 * working copy as the generated form, through the same store actions: saving, the YAML
 * tab and the file's Versions stay the host's.
 */
export function ModuleScreenView({
  view: View,
  projectId,
  source,
  readOnly,
}: {
  view: ComponentType<ConfigScreenProps>;
  projectId: Project["id"];
  source: DataSource;
  readOnly: boolean;
}) {
  const replace = useProjectsStore((s) => s.replaceSourceValueTyped);
  const addSourceRow = useProjectsStore((s) => s.addSourceRow);
  const removeSourceRow = useProjectsStore((s) => s.removeSourceRow);
  const table = source.shape === "table";

  const set: ConfigScreenProps["set"] = (path, value) => {
    if (readOnly) return;
    if (!table) {
      if (path.length > 0) replace({ projectId, sourceId: source.id, row: null, path, value });
      return;
    }
    const [row, ...rest] = path;
    if (typeof row === "number" && rest.length > 0)
      replace({ projectId, sourceId: source.id, row, path: rest, value });
  };

  return (
    <div data-testid="module-screen-view">
      <View
        projectId={projectId}
        shape={table ? "table" : "config"}
        value={table ? source.rows : source.value}
        set={set}
        addRow={() => !readOnly && table && addSourceRow({ projectId, sourceId: source.id })}
        removeRow={(index) =>
          !readOnly && table && removeSourceRow({ projectId, sourceId: source.id, index })
        }
        readOnly={readOnly}
      />
    </div>
  );
}
