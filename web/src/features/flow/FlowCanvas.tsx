import type {
  Action,
  ClickHandler,
  ClickType,
  Command,
  CommandId,
  Element,
  ElementId,
  Menu,
  MenuId,
  PackId,
} from "@/domain/types";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { cx } from "@/lib/cx";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect, useState } from "react";
import { ACTION_TYPES, defaultAction } from "./defaults";
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
 * handlers + actions. Clicking nodes updates the flowSelectionStore which
 * the properties pane consumes; ×/+/↑/↓ controls dispatch structural
 * mutations on accountStore.
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
  if (command) return <CommandFlow packId={packId} command={command} />;

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      const el = layer.elements.find((e) => e.id === id);
      if (el) return <ElementFlow packId={packId} menu={menu} element={el} />;
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
  packId: PackId;
  menu: Menu;
  element: Element;
}

function ElementFlow({ packId, menu, element }: ElementFlowProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "action") ? sub.stateIndex : 0;
  const focusedState = element.appearances[focusedStateIndex] ?? element.appearances[0];

  const material = focusedState?.material ?? "(empty)";
  const textureUrl = itemTextureUrl(material);
  const title = focusedState?.title ?? "";

  const addAppearance = useAccountStore((s) => s.addAppearance);
  const removeAppearance = useAccountStore((s) => s.removeAppearance);

  const onAddAppearance = () => {
    addAppearance({ packId, menuId: menu.id, elementId: element.id });
    // Focus the just-added appearance.
    setSub({ kind: "state", stateIndex: element.appearances.length });
  };
  const onRemoveAppearance = (i: number) => {
    if (element.appearances.length <= 1) return;
    removeAppearance({ packId, menuId: menu.id, elementId: element.id, appearanceIndex: i });
    setSub(null);
  };

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
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: state index is the stable identifier
                  key={i}
                  className={cx(
                    "group relative flex min-w-[160px] flex-col rounded border px-2 py-1.5 text-xs transition-colors",
                    focused
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                      : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSub({ kind: "state", stateIndex: i })}
                    className="text-left"
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
                  {element.appearances.length > 1 ? (
                    <button
                      type="button"
                      title="Remove this state"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAppearance(i);
                      }}
                      className="absolute top-0.5 right-0.5 rounded px-1 text-[10px] text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              onClick={onAddAppearance}
              className="rounded border border-zinc-700 border-dashed px-2 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              + Add state
            </button>
          </div>
        </Lane>

        {/* Click handlers for the focused state */}
        <Lane
          label={`Click handlers · ${focusedStateIndex === 0 ? "default" : `state ${focusedStateIndex}`}`}
        >
          <ClickHandlersGrid
            packId={packId}
            menuId={menu.id}
            elementId={element.id}
            stateIndex={focusedStateIndex}
            click={focusedState?.click}
          />
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
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  click: Element["appearances"][number]["click"];
}

function ClickHandlersGrid({
  packId,
  menuId,
  elementId,
  stateIndex,
  click,
}: ClickHandlersGridProps) {
  const populated = CLICK_TYPE_ORDER.filter((t) => click?.[t]);
  const unpopulated = CLICK_TYPE_ORDER.filter((t) => !click?.[t]);
  const addHandler = useAccountStore((s) => s.addElementClickHandler);

  return (
    <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
      {populated.map((clickType) => (
        <ClickHandlerColumn
          key={clickType}
          packId={packId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          handler={click![clickType]!}
        />
      ))}
      {unpopulated.length > 0 ? (
        <div className="min-w-[220px]">
          <ClickTypePicker
            label="+ Add handler"
            options={unpopulated}
            onPick={(clickType) =>
              addHandler({ packId, menuId, elementId, appearanceIndex: stateIndex, clickType })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

interface ClickHandlerColumnProps {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  handler: ClickHandler;
}

function ClickHandlerColumn({
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  handler,
}: ClickHandlerColumnProps) {
  const removeHandler = useAccountStore((s) => s.removeElementClickHandler);
  const setSub = useFlowSelectionStore((s) => s.set);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between border-zinc-800 border-b px-2 py-1.5">
        <div>
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
        <button
          type="button"
          title="Remove this click handler"
          onClick={() => {
            removeHandler({ packId, menuId, elementId, appearanceIndex: stateIndex, clickType });
            setSub(null);
          }}
          className="rounded px-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      <ActionList
        packId={packId}
        menuId={menuId}
        elementId={elementId}
        stateIndex={stateIndex}
        clickType={clickType}
        actions={handler.actions}
        fallback={false}
      />
      <div className="border-zinc-800 border-t">
        <div className="px-2 pt-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
          on failure
        </div>
        <ActionList
          packId={packId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          actions={handler.fallback ?? []}
          fallback={true}
        />
      </div>
    </div>
  );
}

interface ActionListProps {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  actions: Action[];
  fallback: boolean;
}

function ActionList({
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  actions,
  fallback,
}: ActionListProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const addAction = useAccountStore((s) => s.addElementAction);
  const removeAction = useAccountStore((s) => s.removeElementAction);
  const moveAction = useAccountStore((s) => s.moveElementAction);
  const firstMenuId = useAccountStore(
    (s) => s.account.packs.find((p) => p.id === packId)?.menus[0]?.id,
  );

  const onAdd = (type: Action["type"]) => {
    addAction({
      packId,
      menuId,
      elementId,
      appearanceIndex: stateIndex,
      clickType,
      fallback,
      action: defaultAction(type, firstMenuId),
    });
    setSub({
      kind: "action",
      stateIndex,
      clickType,
      actionIndex: actions.length,
      fallback,
    });
  };

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
          <ActionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: action index is the stable identifier
            key={i}
            action={action}
            focused={focused}
            onClick={() =>
              setSub({ kind: "action", stateIndex, clickType, actionIndex: i, fallback })
            }
            onRemove={() => {
              removeAction({
                packId,
                menuId,
                elementId,
                appearanceIndex: stateIndex,
                clickType,
                fallback,
                actionIndex: i,
              });
              if (focused) setSub(null);
            }}
            onMoveUp={
              i > 0
                ? () =>
                    moveAction({
                      packId,
                      menuId,
                      elementId,
                      appearanceIndex: stateIndex,
                      clickType,
                      fallback,
                      fromIndex: i,
                      toIndex: i - 1,
                    })
                : undefined
            }
            onMoveDown={
              i < actions.length - 1
                ? () =>
                    moveAction({
                      packId,
                      menuId,
                      elementId,
                      appearanceIndex: stateIndex,
                      clickType,
                      fallback,
                      fromIndex: i,
                      toIndex: i + 1,
                    })
                : undefined
            }
          />
        );
      })}
      <ActionTypePicker label="+ Add action" onPick={onAdd} />
    </div>
  );
}

interface ActionRowProps {
  action: Action;
  focused: boolean;
  onClick: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function ActionRow({ action, focused, onClick, onRemove, onMoveUp, onMoveDown }: ActionRowProps) {
  return (
    <div
      className={cx(
        "group flex items-center gap-1.5 rounded border px-2 py-1 transition-colors",
        focused
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-zinc-800 bg-zinc-950 hover:border-zinc-600",
      )}
    >
      <button type="button" onClick={onClick} className="flex flex-1 items-center gap-2 text-left">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-300">
          {actionTypeLabel(action.type)}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-zinc-200">
          {actionSummary(action)}
        </span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <RowIconButton title="Move up" disabled={!onMoveUp} onClick={onMoveUp}>
          ↑
        </RowIconButton>
        <RowIconButton title="Move down" disabled={!onMoveDown} onClick={onMoveDown}>
          ↓
        </RowIconButton>
        <RowIconButton title="Remove" onClick={onRemove}>
          ×
        </RowIconButton>
      </div>
    </div>
  );
}

function RowIconButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded px-1 text-[10px]",
        disabled
          ? "cursor-not-allowed text-zinc-700"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

interface ClickTypePickerProps {
  label: string;
  options: ClickType[];
  onPick: (clickType: ClickType) => void;
}

function ClickTypePicker({ label, options, onPick }: ClickTypePickerProps) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-zinc-700 border-dashed px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onPick(opt);
                setOpen(false);
              }}
              className="block w-full px-2 py-1 text-left font-mono text-[11px] text-zinc-200 hover:bg-zinc-800"
            >
              {clickTypeLabel(opt)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ActionTypePickerProps {
  label: string;
  onPick: (type: Action["type"]) => void;
}

function ActionTypePicker({ label, onPick }: ActionTypePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-zinc-700 border-dashed px-2 py-1 text-left text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {ACTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onPick(type);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-zinc-800"
            >
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-300">
                {actionTypeLabel(type)}
              </span>
              <span className="font-mono text-[11px] text-zinc-200">{type}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface CommandFlowProps {
  packId: PackId;
  command: Command;
}

function CommandFlow({ packId, command }: CommandFlowProps) {
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
            <CommandActionList packId={packId} commandId={command.id} actions={command.actions} />
          </div>
        </Lane>
      </div>
    </div>
  );
}

interface CommandActionListProps {
  packId: PackId;
  commandId: CommandId;
  actions: Action[];
}

function CommandActionList({ packId, commandId, actions }: CommandActionListProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const addAction = useAccountStore((s) => s.addCommandAction);
  const removeAction = useAccountStore((s) => s.removeCommandAction);
  const moveAction = useAccountStore((s) => s.moveCommandAction);
  const firstMenuId = useAccountStore(
    (s) => s.account.packs.find((p) => p.id === packId)?.menus[0]?.id,
  );

  return (
    <div className="flex flex-col gap-1 p-2">
      {actions.map((action, i) => {
        const focused = sub?.kind === "commandAction" && sub.actionIndex === i;
        return (
          <ActionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: action index is stable
            key={i}
            action={action}
            focused={focused}
            onClick={() => setSub({ kind: "commandAction", actionIndex: i })}
            onRemove={() => {
              removeAction({ packId, commandId, actionIndex: i });
              if (focused) setSub(null);
            }}
            onMoveUp={
              i > 0
                ? () => moveAction({ packId, commandId, fromIndex: i, toIndex: i - 1 })
                : undefined
            }
            onMoveDown={
              i < actions.length - 1
                ? () => moveAction({ packId, commandId, fromIndex: i, toIndex: i + 1 })
                : undefined
            }
          />
        );
      })}
      <ActionTypePicker
        label="+ Add action"
        onPick={(type) => {
          addAction({ packId, commandId, action: defaultAction(type, firstMenuId) });
          setSub({ kind: "commandAction", actionIndex: actions.length });
        }}
      />
    </div>
  );
}
