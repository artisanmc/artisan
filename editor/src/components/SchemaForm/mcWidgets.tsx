import { RevealField } from "@/components/RevealField";
import type { ProjectId } from "@/domain/types";
import { MaterialRefField } from "@/features/canvas/MaterialRefField";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
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
 * `actions` (steps/conditions editor) lands with the controlled pseudocode
 * refactor. Instantiate per project: `widgets={mcWidgets(projectId)}`.
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

  return {
    material,
    minimessage: mini(false),
    minimessage_multiline: mini(true),
  };
}
