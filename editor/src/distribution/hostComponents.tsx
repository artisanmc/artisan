import { MiniMessageField } from "@/components/MiniMessageField";
import { SortableList } from "@/components/ui/sortable-list";
import type { ProjectId } from "@/domain/types";
import { MaterialField } from "@/features/canvas/MaterialField";
import { ItemSpecField } from "@/features/canvas/item/ItemSpecField";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import type { HostComponents } from "@artisan/editor-sdk";

/**
 * The editor widgets a module view embeds through the SDK (`ActionChainEditor`,
 * `MaterialInput`, `ItemInput`, `MiniMessageInput`, `SortableList`): the same components as the core
 * views, on a controlled value.
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
  MiniMessageInput: (props) => <MiniMessageField {...props} />,
  SortableList: (props) => <SortableList {...props} />,
  ItemInput: ({ match, onMatchChange, ...props }) => (
    <ItemSpecField
      {...props}
      match={match}
      onMatchChange={onMatchChange && ((next) => onMatchChange(next as typeof match))}
    />
  ),
};
