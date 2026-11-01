import { MiniMessageField } from "@/components/MiniMessageField";
import { McScreen, McScreenControls, McText } from "@/components/mc-preview";
import { LocalizedField } from "@/components/ui/localized-field";
import { SortableList } from "@/components/ui/sortable-list";
import type { ProjectId } from "@/domain/types";
import { AssetInput } from "@/features/assets/AssetInput";
import { MaterialField } from "@/features/canvas/MaterialField";
import { ItemSpecField } from "@/features/canvas/item/ItemSpecField";
import { OverlayComposer } from "@/features/canvas/overlay/OverlayComposer";
import { OverlaySlotsComposer } from "@/features/canvas/overlay/OverlaySlotsComposer";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import { ConditionsField } from "@/features/inspector/properties/ConditionsField";
import { DocumentRefField } from "@/features/inspector/properties/DocumentRefField";
import { useFieldTranslate } from "@/lib/aiTranslate";
import type { HostComponents } from "@artisan/editor-sdk";

/**
 * The editor widgets a module view embeds through the SDK (`ActionChainEditor`,
 * `MaterialInput`, `ItemInput`, `MiniMessageInput`, `SortableList`, `ConditionsEditor`,
 * `DocumentRefInput`, `McText`, `McScreen`, `McScreenControls`, `OverlayComposer`, `OverlaySlotsComposer`, `AssetInput`, `LocalizedField`): the same
 * components as the core views, on a controlled value.
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
  ConditionsEditor: ({ value, onChange, label, emptyHint }) => (
    <ConditionsField value={value} onChange={onChange} label={label} emptyHint={emptyHint} />
  ),
  DocumentRefInput: (props) => <DocumentRefField {...props} />,
  McText: (props) => <McText {...props} />,
  McScreen: (props) => <McScreen {...props} />,
  McScreenControls: (props) => <McScreenControls {...props} />,
  OverlayComposer: (props) => <OverlayComposer {...props} />,
  OverlaySlotsComposer: (props) => <OverlaySlotsComposer {...props} />,
  AssetInput: (props) => <AssetInput {...props} />,
  LocalizedField: function HostLocalizedField(props) {
    // A module's own texts get "Translate the missing ones" too, when the assistant is on.
    const translate = useFieldTranslate();
    return <LocalizedField translate={translate} {...props} />;
  },
  ItemInput: ({ match, onMatchChange, ...props }) => (
    <ItemSpecField
      {...props}
      match={match}
      onMatchChange={onMatchChange && ((next) => onMatchChange(next as typeof match))}
    />
  ),
};
