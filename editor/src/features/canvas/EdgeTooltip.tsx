import type { Pack } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useUiStore } from "@/state/uiStore";
import { itemTextureUrl } from "./itemTextures";

interface EdgeTooltipProps {
  pack: Pack;
}

export function EdgeTooltip({ pack }: EdgeTooltipProps) {
  const edge = useEdgeHoverStore((s) => s.edge);
  const x = useEdgeHoverStore((s) => s.x);
  const y = useEdgeHoverStore((s) => s.y);
  const activeLang = useUiStore((s) => s.activeLang);

  if (!edge) return null;

  const nodeName = (id: string): string => {
    const menu = pack.menus.find((m) => m.id === id);
    if (menu) return getText(pack, menu.title, activeLang) || id;
    const cmd = pack.commands.find((c) => c.id === id);
    if (cmd) return `/${cmd.name}`;
    const dialog = (pack.dialogs ?? []).find((d) => d.id === id);
    if (dialog) return `[dialog] ${id}`;
    return id;
  };

  const elementLabel = (elementId: string): string => {
    for (const menu of pack.menus) {
      for (const layer of menu.layers) {
        const el = layer.elements.find((e) => e.id === elementId);
        if (el) {
          const title = getText(pack, el.appearances[0]?.title, activeLang);
          return title || elementId;
        }
      }
    }
    return elementId;
  };

  return (
    <div
      style={{ left: x + 14, top: y + 14 }}
      className="pointer-events-none fixed z-[9999] max-w-[240px] rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 shadow-lg"
    >
      <div className="mb-1.5 font-mono text-[10px] text-zinc-400 uppercase tracking-wide">
        {nodeName(edge.source)} → {nodeName(edge.target)}
      </div>
      <div className="flex flex-col gap-1">
        {edge.triggers.map((trigger, i) =>
          trigger.kind === "element" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <ElementIcon material={trigger.material} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
                {elementLabel(trigger.elementId)}
              </span>
              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                {trigger.clickType}
              </span>
            </div>
          ) : trigger.kind === "dialog_button" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-violet-900/60 px-1.5 py-0.5 font-mono text-[9px] text-violet-300">
                dialog
              </span>
              <span className="font-mono text-xs text-zinc-300">{trigger.buttonId}</span>
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per tooltip render
            <div key={i} className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-zinc-300">
                /
                {pack.commands.find((c) => c.id === trigger.commandId)?.name ??
                  trigger.commandId}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ElementIcon({ material }: { material: string }) {
  const url = itemTextureUrl(material);
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
      {url ? (
        <img
          src={url}
          alt={material}
          draggable={false}
          className="h-3.5 w-3.5 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="font-mono text-[7px] text-zinc-600">{material.slice(0, 3) || "?"}</span>
      )}
    </div>
  );
}
