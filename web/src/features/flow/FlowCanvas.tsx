import type {
  Action,
  ClickHandler,
  ClickType,
  Command,
  Element,
  Menu,
  PackId,
} from "@/domain/types";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { cx } from "@/lib/cx";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";
import {
  CLICK_TYPE_ORDER,
  actionSummary,
  actionTypeLabel,
  clickTypeLabel,
  conditionSummary,
} from "./labels";

interface FlowCanvasProps {
  packId: PackId;
}

/**
 * Bottom canvas. Resolves the current top-canvas selection to either an
 * element or a command and renders its action structure: states + click
 * handlers + actions. Read-only for now; clicking nodes updates a sub-
 * selection store that the properties pane can consume in a later phase.
 */
export function FlowCanvas({ packId }: FlowCanvasProps) {
  const ids = useSelectionStore((s) => s.ids);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const setSub = useFlowSelectionStore((s) => s.set);

  // Reset the sub-selection whenever the top selection changes — different
  // entity = different state/action tree.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids change is the trigger
  useEffect(() => {
    setSub(null);
  }, [setSub, [...ids].sort().join(",")]);

  if (!pack) return <EmptyHint label="Pack not found." />;
  if (ids.size === 0) return <EmptyHint label="Select an element or command to edit its flow." />;
  if (ids.size > 1) return <EmptyHint label="Flow editing is per-button — narrow the selection." />;

  const id = [...ids][0]!;
  const command = pack.commands.find((c) => c.id === id);
  if (command) return <CommandFlow command={command} />;

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      const el = layer.elements.find((e) => e.id === id);
      if (el) return <ElementFlow menu={menu} element={el} />;
    }
  }
  if (pack.menus.some((m) => m.id === id))
    return <EmptyHint label="Menu selected — click an item or command to edit its flow." />;
  return <EmptyHint label="Selection has no flow." />;
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">
      {label}
    </div>
  );
}

interface ElementFlowProps {
  menu: Menu;
  element: Element;
}

function ElementFlow({ menu, element }: ElementFlowProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "action") ? sub.stateIndex : 0;
  const focusedState = element.appearances[focusedStateIndex] ?? element.appearances[0];

  const material = focusedState?.material ?? "(empty)";
  const textureUrl = itemTextureUrl(material);
  const title = focusedState?.title ?? "";

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header strip */}
      <div className="flex items-center gap-3 border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
          {textureUrl ? (
            <img
              src={textureUrl}
              alt={material}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[8px] text-zinc-500">{material.slice(0, 4)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-zinc-200">{title || material}</div>
          <div className="text-[10px] text-zinc-500">
            {menu.title} · slot
            {element.positions.includes(",") || element.positions.includes("-") ? "s" : ""}{" "}
            {element.positions} · {element.appearances.length} state
            {element.appearances.length > 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        {/* States lane */}
        <Lane label="States">
          <div className="flex flex-wrap gap-2">
            {element.appearances.map((appearance, i) => {
              const focused = focusedStateIndex === i;
              const conds = appearance.if ?? [];
              const isDefault = conds.length === 0;
              return (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: state index is the stable identifier here
                  key={i}
                  type="button"
                  onClick={() => setSub({ kind: "state", stateIndex: i })}
                  className={cx(
                    "min-w-[140px] rounded border px-2 py-1.5 text-left text-xs transition-colors",
                    focused
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                      : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                      {isDefault ? "default" : `state ${i}`}
                    </span>
                    {appearance.material ? (
                      <span className="truncate font-mono text-[10px] text-zinc-400">
                        {appearance.material}
                      </span>
                    ) : null}
                  </div>
                  {!isDefault && (
                    <div className="mt-1 text-[10px] text-zinc-500">
                      {conds.map((c, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: condition index is stable in render
                        <div key={j} className="truncate">
                          • {conditionSummary(c)}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              disabled
              className="rounded border border-zinc-800 border-dashed px-2 py-1.5 text-xs text-zinc-600"
              title="Adding states will land in a later phase"
            >
              + Add state
            </button>
          </div>
        </Lane>

        {/* Click handlers for the focused state */}
        <Lane
          label={`Click handlers · ${focusedStateIndex === 0 ? "default" : `state ${focusedStateIndex}`}`}
        >
          <ClickHandlersGrid stateIndex={focusedStateIndex} click={focusedState?.click} />
        </Lane>
      </div>
    </div>
  );
}

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

interface ClickHandlersGridProps {
  stateIndex: number;
  click: Element["appearances"][number]["click"];
}

function ClickHandlersGrid({ stateIndex, click }: ClickHandlersGridProps) {
  const populated = CLICK_TYPE_ORDER.filter((t) => click?.[t]);
  if (populated.length === 0) {
    return (
      <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/50 px-3 py-4 text-center text-[11px] text-zinc-500">
        No click handlers — this state is purely decorative.
      </div>
    );
  }
  return (
    <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
      {populated.map((clickType) => (
        <ClickHandlerColumn
          key={clickType}
          stateIndex={stateIndex}
          clickType={clickType}
          handler={click![clickType]!}
        />
      ))}
    </div>
  );
}

interface ClickHandlerColumnProps {
  stateIndex: number;
  clickType: ClickType;
  handler: ClickHandler;
}

function ClickHandlerColumn({ stateIndex, clickType, handler }: ClickHandlerColumnProps) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60">
      <div className="border-zinc-800 border-b px-2 py-1.5">
        <div className="font-mono text-[11px] text-zinc-200">{clickTypeLabel(clickType)}</div>
        {handler.requirements && handler.requirements.length > 0 ? (
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {handler.requirements.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: requirement index is stable in render
              <div key={i} className="truncate">
                if {conditionSummary(c)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ActionList
        stateIndex={stateIndex}
        clickType={clickType}
        actions={handler.actions}
        fallback={false}
      />
      {handler.fallback && handler.fallback.length > 0 ? (
        <div className="border-zinc-800 border-t">
          <div className="px-2 pt-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
            on failure
          </div>
          <ActionList
            stateIndex={stateIndex}
            clickType={clickType}
            actions={handler.fallback}
            fallback={true}
          />
        </div>
      ) : null}
    </div>
  );
}

interface ActionListProps {
  stateIndex: number;
  clickType: ClickType;
  actions: Action[];
  fallback: boolean;
}

function ActionList({ stateIndex, clickType, actions, fallback }: ActionListProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  if (actions.length === 0) {
    return <div className="px-2 py-2 text-[10px] text-zinc-600 italic">(no actions)</div>;
  }
  return (
    <div className="flex flex-col gap-1 p-2">
      {actions.map((action, i) => {
        const focused =
          sub?.kind === "action" &&
          sub.stateIndex === stateIndex &&
          sub.clickType === clickType &&
          sub.actionIndex === i &&
          sub.fallback === fallback;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: action index is the stable identifier here
            key={i}
            type="button"
            onClick={() =>
              setSub({ kind: "action", stateIndex, clickType, actionIndex: i, fallback })
            }
            className={cx(
              "flex items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
              focused
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-zinc-800 bg-zinc-950 hover:border-zinc-600",
            )}
          >
            <span
              className={cx(
                "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide",
                "bg-zinc-800 text-zinc-300",
              )}
            >
              {actionTypeLabel(action.type)}
            </span>
            <span className="flex-1 truncate font-mono text-[11px] text-zinc-200">
              {actionSummary(action)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface CommandFlowProps {
  command: Command;
}

function CommandFlow({ command }: CommandFlowProps) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="font-mono text-xs text-zinc-200">/{command.name}</div>
        <div className="text-[10px] text-zinc-500">
          {command.permission ? `perm: ${command.permission} · ` : ""}
          {command.actions.length} action{command.actions.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3">
        <Lane label="Actions">
          <div className="rounded border border-zinc-800 bg-zinc-900/60">
            <CommandActionList actions={command.actions} />
          </div>
        </Lane>
      </div>
    </div>
  );
}

function CommandActionList({ actions }: { actions: Action[] }) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  if (actions.length === 0) {
    return <div className="px-2 py-2 text-[10px] text-zinc-600 italic">(no actions)</div>;
  }
  return (
    <div className="flex flex-col gap-1 p-2">
      {actions.map((action, i) => {
        const focused = sub?.kind === "commandAction" && sub.actionIndex === i;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: action index is stable
            key={i}
            type="button"
            onClick={() => setSub({ kind: "commandAction", actionIndex: i })}
            className={cx(
              "flex items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
              focused
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-zinc-800 bg-zinc-950 hover:border-zinc-600",
            )}
          >
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-300">
              {actionTypeLabel(action.type)}
            </span>
            <span className="flex-1 truncate font-mono text-[11px] text-zinc-200">
              {actionSummary(action)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
