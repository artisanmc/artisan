import type { ProjectId } from "@/domain/types";
import { MaterialField } from "@/features/canvas/MaterialField";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import type { HostComponents } from "@artisan/editor-sdk";

/**
 * The editor widgets a module view embeds through the SDK (`ActionChainEditor`,
 * `MaterialInput`): the same components as the core views, on a controlled value.
 */
export const hostComponents: HostComponents = {
  ActionChainEditor: ({ projectId, value, onChange }) => (
    <ActionFieldEditor
      projectId={projectId as ProjectId}
      value={value}
      onChange={(next) => onChange(Array.isArray(next) ? next : [])}
    />
  ),
  MaterialInput: (props) => <MaterialField {...props} />,
};
