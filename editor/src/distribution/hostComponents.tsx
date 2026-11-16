import { MiniMessageField } from "@/components/MiniMessageField";
import { McScreen, McScreenControls, McText } from "@/components/mc-preview";
import { BarList } from "@/components/ui/bar-list";
import { Funnel } from "@/components/ui/funnel";
import { LocalizedField } from "@/components/ui/localized-field";
import { SortableList } from "@/components/ui/sortable-list";
import { SortableTable } from "@/components/ui/sortable-table";
import { StatCard } from "@/components/ui/stat-card";
import { Panel } from "@/components/ui/stats-panel";
import { TimeChart } from "@/components/ui/time-chart";
import type { ProjectId } from "@/domain/types";
import { AssetInput } from "@/features/assets/AssetInput";
import { ItemValueField } from "@/features/canvas/ItemValueField";
import { MaterialField } from "@/features/canvas/MaterialField";
import { ItemSpecField } from "@/features/canvas/item/ItemSpecField";
import { OverlayComposer } from "@/features/canvas/overlay/OverlayComposer";
import { OverlaySlotsComposer } from "@/features/canvas/overlay/OverlaySlotsComposer";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import { ConditionsField } from "@/features/inspector/properties/ConditionsField";
import { DocumentRefField } from "@/features/inspector/properties/DocumentRefField";
import { PageTour } from "@/features/onboarding/PageTour";
import { useFieldTranslate } from "@/lib/aiTranslate";
import type { HostComponents } from "@artisan/editor-sdk";

/**
 * The editor widgets a module view embeds through the SDK (`ActionChainEditor`,
 * `MaterialInput`, `ItemInput`, `MiniMessageInput`, `SortableList`, `ConditionsEditor`,
 * `DocumentRefInput`, `McText`, `McScreen`, `McScreenControls`, `OverlayComposer`, `OverlaySlotsComposer`, `AssetInput`, `LocalizedField`, `PageTour`, `ItemValueInput`, and the statistics components `StatCard`, `TimeChart`, `BarList`, `Funnel`, `SortableTable`, `StatsPanel`): the same
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
  StatCard: (props) => <StatCard {...props} />,
  TimeChart: (props) => <TimeChart {...props} />,
  BarList: (props) => <BarList {...props} />,
  Funnel: (props) => <Funnel {...props} />,
  SortableTable: (props) => <SortableTable {...props} />,
  StatsPanel: (props) => <Panel {...props} />,
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
  PageTour: (props) => <PageTour {...props} />,
  LocalizedField: function HostLocalizedField(props) {
    // A module's own texts get "Translate the missing ones" too, when the assistant is on.
    const translate = useFieldTranslate();
    return <LocalizedField translate={translate} {...props} />;
  },
  ItemValueInput: ({ projectId, value, onChange }) => (
    <ItemValueField projectId={projectId as ProjectId} value={value} onChange={onChange} />
  ),
  ItemInput: ({ match, onMatchChange, ...props }) => (
    <ItemSpecField
      {...props}
      match={match}
      onMatchChange={onMatchChange && ((next) => onMatchChange(next as typeof match))}
    />
  ),
};
