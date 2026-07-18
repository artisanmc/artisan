import { RevealField } from "@/components/RevealField";
import type { ProjectId } from "@/domain/types";
import { MaterialRefField } from "@/features/canvas/MaterialRefField";
import { ControlledStepsEditor } from "@/features/flow/ControlledStepsEditor";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { stepsFromWire, stepsToWire } from "@/lib/literalSteps";
import type { ComponentType } from "react";
import type { JsonSchema } from "./types";

interface WidgetProps {
  value: unknown;
  onChange: (v: unknown) => void;
  schema: JsonSchema;
}

/**
 * The Minecraft field kit for module forms (ADR
 * `captured-items-and-module-field-kit` §4): standard widgets every module
 * gets for free by declaring `format` in its JSON Schema —
 *   - `material`               → universal material-ref picker (vanilla, nexo:, item:)
 *   - `minimessage`            → rendered facade → raw source on click
 *   - `minimessage_multiline`  → textarea variant
 *   - `actions`                → controlled pseudocode steps/conditions editor
 *                                (literal text; wire shape = exported step trees)
 * Instantiate per project: `widgets={mcWidgets(projectId)}`.
 */
export function mcWidgets(projectId: ProjectId): Record<string, ComponentType<WidgetProps>> {
  const material: ComponentType<WidgetProps> = ({ value, onChange, schema }) => (
    <label className="flex flex-col gap-1 text-sm">
      {schema.title ? <span>{schema.title}</span> : null}
      <MaterialRefField
        projectId={projectId}
        value={String(value ?? "")}
        onChange={(v) => onChange(v)}
      />
    </label>
  );

  const mini = (multiline: boolean): ComponentType<WidgetProps> => {
    return ({ value, onChange, schema }) => {
      const text = String(value ?? "");
      return (
        <label className="flex flex-col gap-1 text-sm">
          {schema.title ? <span>{schema.title}</span> : null}
          <RevealField
            value={text}
            onChange={(v) => onChange(v)}
            entries={[]}
            multiline={multiline}
            rows={multiline ? 3 : undefined}
            className="text-xs"
            facade={<MiniMessageInline source={text} className="font-mono text-xs" />}
          />
        </label>
      );
    };
  };

  const actions: ComponentType<WidgetProps> = ({ value, onChange, schema }) => (
    <div className="flex flex-col gap-1 text-sm">
      {schema.title ? <span>{schema.title}</span> : null}
      <ControlledStepsEditor
        projectId={projectId}
        value={stepsFromWire(value)}
        onChange={(steps) => onChange(stepsToWire(steps))}
      />
    </div>
  );

  return {
    material,
    minimessage: mini(false),
    minimessage_multiline: mini(true),
    actions,
  };
}
