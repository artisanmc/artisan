import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useUiStore } from "@/state/uiStore";
import { getTextureUrl } from "./textureStore";

interface EdgeTooltipProps {
  project: Project;
}

export function EdgeTooltip({ project }: EdgeTooltipProps) {
  const edge = useEdgeHoverStore((s) => s.edge);
  const x = useEdgeHoverStore((s) => s.x);
  const y = useEdgeHoverStore((s) => s.y);
  const activeLang = useUiStore((s) => s.activeLang);

  if (!edge) return null;

  const nodeName = (id: string): string => {
    const menu = project.menus.find((m) => m.id === id);
    if (menu) {
      const lt = getFirstTitleText(menu);
      return (lt ? getText(project, lt, activeLang) : "") || id;
    }
    const cmd = project.commands.find((c) => c.id === id);
    if (cmd) return `/${cmd.name}`;
    const dialog = (project.dialogs ?? []).find((d) => d.id === id);
    if (dialog) return `[dialog] ${id}`;
    return id;
  };

  const elementLabel = (elementId: string): string => {
    for (const menu of project.menus) {
      for (const layer of menu.layers) {
        const el = layer.elements.find((e) => e.id === elementId);
        if (el) {
          const title = getText(project, el.appearances[0]?.title, activeLang);
          return title || elementId;
        }
      }
    }
    return elementId;
  };

  return (
    <div
      style={{ left: x + 14, top: y + 14, boxShadow: "var(--shadow-md)" }}
      className="card pointer-events-none fixed z-[9999] max-w-[240px] px-2.5 py-2"
    >
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-mut)]">
        <MiniMessageInline source={nodeName(edge.source)} /> →{" "}
        <MiniMessageInline source={nodeName(edge.target)} />
      </div>
      <div className="flex flex-col gap-1">
        {edge.triggers.map((trigger, i) =>
          trigger.kind === "element" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <ElementIcon material={trigger.material} />
              <MiniMessageInline
                source={elementLabel(trigger.elementId)}
                className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text)]"
              />
              <span className="badge badge-terra shrink-0 font-mono">{trigger.clickType}</span>
            </div>
          ) : trigger.kind === "dialog_button" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <span className="badge badge-sage shrink-0 font-mono">dialog</span>
              <span className="font-mono text-xs text-[var(--text-mut)]">{trigger.buttonId}</span>
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-[var(--text-mut)]">
                /{project.commands.find((c) => c.id === trigger.commandId)?.name ?? trigger.commandId}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ElementIcon({ material }: { material: string }) {
  const url = getTextureUrl(material);
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border-soft)] bg-[var(--surface-inset)]">
      {url ? (
        <img
          src={url}
          alt={material}
          draggable={false}
          className="h-3.5 w-3.5 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="font-mono text-[7px] text-[var(--text-faint)]">
          {material.slice(0, 3) || "?"}
        </span>
      )}
    </div>
  );
}
