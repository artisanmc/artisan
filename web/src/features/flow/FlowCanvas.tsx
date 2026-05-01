import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { StepFrame } from "@/domain/stepPath";
import type {
  Action,
  ClickHandler,
  ClickType,
  Command,
  CommandId,
  Condition,
  Element,
  ElementId,
  IfCase,
  Menu,
  MenuId,
  PackId,
  Step,
} from "@/domain/types";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { ActionEditor } from "@/features/canvas/properties/ActionEditor";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
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
 * Bottom canvas. Renders the recursive Step tree of the selected element /
 * command as a horizontal flow with `if`-branches fanning out vertically
 * below their parent step. Clicking nodes drives the flowSelectionStore so
 * the right-side properties pane edits the right thing.
 */
export function FlowCanvas({ packId }: FlowCanvasProps) {
  const ids = useSelectionStore((s) => s.ids);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const setSub = useFlowSelectionStore((s) => s.set);

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

// ────────────────────────────────────────────────────────────────────────────
// Element flow
// ────────────────────────────────────────────────────────────────────────────

function ElementFlow({
  packId,
  menu,
  element,
}: {
  packId: PackId;
  menu: Menu;
  element: Element;
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "step") ? (sub.stateIndex ?? 0) : 0;
  const focusedState = element.appearances[focusedStateIndex] ?? element.appearances[0];

  const material = focusedState?.material ?? "(empty)";
  const textureUrl = itemTextureUrl(material);
  const title = focusedState?.title ?? "";

  const addAppearance = useAccountStore((s) => s.addAppearance);
  const removeAppearance = useAccountStore((s) => s.removeAppearance);
  const setAppearanceConditions = useAccountStore((s) => s.setAppearanceConditions);
  const setAppearanceJoin = useAccountStore((s) => s.setAppearanceJoin);
  const setAppearanceField = useAccountStore((s) => s.setAppearanceField);

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
              const isDefault = (appearance.if ?? []).length === 0;
              const material = appearance.material ?? "";
              const textureUrl = itemTextureUrl(material);
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: state index is stable
                  key={i}
                  className={cx(
                    "group relative flex w-[320px] flex-col gap-1.5 overflow-hidden rounded border px-2 py-1.5 text-xs transition-colors",
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
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                      {isDefault ? "default" : `state ${i}`}
                    </span>
                  </button>
                  {/* Material row — item icon + editable name. */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
                      {textureUrl ? (
                        <img
                          src={textureUrl}
                          alt={material}
                          draggable={false}
                          className="h-3/4 w-3/4 object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <span className="text-[8px] text-zinc-600">
                          {material.slice(0, 3) || "—"}
                        </span>
                      )}
                    </div>
                    <Input
                      value={material}
                      placeholder="DIAMOND"
                      onChange={(e) =>
                        setAppearanceField({
                          packId,
                          menuId: menu.id,
                          elementId: element.id,
                          appearanceIndex: i,
                          field: "material",
                          value: e.target.value.toUpperCase(),
                        })
                      }
                      className="h-6 flex-1 px-1.5 py-0 font-mono text-[11px]"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <ConditionListEditor
                      label=""
                      conditions={appearance.if ?? []}
                      joins={appearance.ifJoins}
                      emptyHint={
                        isDefault
                          ? "default · always visible"
                          : "(always — drop a condition here to gate this state)"
                      }
                      onChange={(conditions) =>
                        setAppearanceConditions({
                          packId,
                          menuId: menu.id,
                          elementId: element.id,
                          appearanceIndex: i,
                          conditions,
                        })
                      }
                      onJoinChange={(joinIndex, op) =>
                        setAppearanceJoin({
                          packId,
                          menuId: menu.id,
                          elementId: element.id,
                          appearanceIndex: i,
                          joinIndex,
                          op,
                        })
                      }
                    />
                  </div>
                  {element.appearances.length > 1 ? (
                    <button
                      type="button"
                      title="Remove this state"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAppearance({
                          packId,
                          menuId: menu.id,
                          elementId: element.id,
                          appearanceIndex: i,
                        });
                        setSub(null);
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
              onClick={() => {
                addAppearance({ packId, menuId: menu.id, elementId: element.id });
                setSub({ kind: "state", stateIndex: element.appearances.length });
              }}
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

function ClickHandlersGrid({
  packId,
  menuId,
  elementId,
  stateIndex,
  click,
}: {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  click: Element["appearances"][number]["click"];
}) {
  const populated = CLICK_TYPE_ORDER.filter((t) => click?.[t]);
  const unpopulated = CLICK_TYPE_ORDER.filter((t) => !click?.[t]);
  const addHandler = useAccountStore((s) => s.addElementClickHandler);
  const removeHandler = useAccountStore((s) => s.removeElementClickHandler);
  const setSub = useFlowSelectionStore((s) => s.set);

  return (
    <div className="flex flex-col gap-3">
      {populated.map((clickType) => (
        <ElementHandlerRow
          key={clickType}
          packId={packId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          handler={click![clickType]!}
          onRemove={() => {
            removeHandler({ packId, menuId, elementId, appearanceIndex: stateIndex, clickType });
            setSub(null);
          }}
        />
      ))}
      {unpopulated.length > 0 ? (
        <ClickTypePicker
          label="+ Add click handler"
          options={unpopulated}
          onPick={(clickType) =>
            addHandler({ packId, menuId, elementId, appearanceIndex: stateIndex, clickType })
          }
        />
      ) : null}
    </div>
  );
}

function ElementHandlerRow({
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  handler,
  onRemove,
}: {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  handler: ClickHandler;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-zinc-800 border-b px-2 py-1.5">
        <span className="font-mono text-[11px] text-zinc-200">{clickTypeLabel(clickType)}</span>
        <button
          type="button"
          title="Remove this click handler"
          onClick={onRemove}
          className="rounded px-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      <div className="overflow-x-auto p-2">
        <ElementStepFlow
          packId={packId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          steps={handler.steps}
          frames={[]}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recursive step renderer (element)
// ────────────────────────────────────────────────────────────────────────────

interface ElementStepFlowProps {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  steps: Step[];
  frames: StepFrame[];
}

function ElementStepFlow(props: ElementStepFlowProps) {
  const { packId, menuId, elementId, stateIndex, clickType, steps, frames } = props;
  const addElementStep = useAccountStore((s) => s.addElementStep);
  const setSub = useFlowSelectionStore((s) => s.set);
  const firstMenuId = useAccountStore(
    (s) => s.account.packs.find((p) => p.id === packId)?.menus[0]?.id,
  );

  const handleAdd = (newStep: Step) => {
    const newIndex = steps.length;
    addElementStep({
      packId,
      menuId,
      elementId,
      appearanceIndex: stateIndex,
      clickType,
      frames,
      index: newIndex,
      step: newStep,
    });
    setSub({
      kind: "step",
      stateIndex,
      clickType,
      path: { frames, index: newIndex },
    });
  };

  return (
    <div className="flex items-stretch gap-2">
      {steps.length === 0 ? (
        <EmptyChainHint />
      ) : (
        steps.map((step, i) => (
          <ElementStepNode
            // biome-ignore lint/suspicious/noArrayIndexKey: step index stable per render
            key={i}
            step={step}
            stepIndex={i}
            isLast={i === steps.length - 1}
            packId={packId}
            menuId={menuId}
            elementId={elementId}
            stateIndex={stateIndex}
            clickType={clickType}
            frames={frames}
          />
        ))
      )}
      <AddStepPicker firstMenuId={firstMenuId} onPick={handleAdd} />
    </div>
  );
}

function ElementStepNode({
  step,
  stepIndex,
  isLast,
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  frames,
}: {
  step: Step;
  stepIndex: number;
  isLast: boolean;
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  frames: StepFrame[];
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const removeElementStep = useAccountStore((s) => s.removeElementStep);
  const moveElementStep = useAccountStore((s) => s.moveElementStep);
  const setElementStep = useAccountStore((s) => s.setElementStep);

  const focused =
    sub?.kind === "step" &&
    sub.clickType === clickType &&
    sub.stateIndex === stateIndex &&
    framesEqual(sub.path.frames, frames) &&
    sub.path.index === stepIndex;

  const onSelect = () =>
    setSub({ kind: "step", stateIndex, clickType, path: { frames, index: stepIndex } });
  const onRemove = () => {
    removeElementStep({
      packId,
      menuId,
      elementId,
      appearanceIndex: stateIndex,
      clickType,
      path: { frames, index: stepIndex },
    });
    if (focused) setSub(null);
  };
  const onMoveLeft = () =>
    moveElementStep({
      packId,
      menuId,
      elementId,
      appearanceIndex: stateIndex,
      clickType,
      frames,
      fromIndex: stepIndex,
      toIndex: stepIndex - 1,
    });
  const onMoveRight = () =>
    moveElementStep({
      packId,
      menuId,
      elementId,
      appearanceIndex: stateIndex,
      clickType,
      frames,
      fromIndex: stepIndex,
      toIndex: stepIndex + 1,
    });

  return (
    <>
      {step.kind === "action" ? (
        <ActionCard
          action={step.action}
          focused={focused}
          packId={packId}
          onSelect={onSelect}
          onRemove={onRemove}
          onActionChange={(next) =>
            setElementStep({
              packId,
              menuId,
              elementId,
              appearanceIndex: stateIndex,
              clickType,
              path: { frames, index: stepIndex },
              step: { kind: "action", action: next },
            })
          }
          onMoveLeft={stepIndex > 0 ? onMoveLeft : undefined}
          onMoveRight={!isLast ? onMoveRight : undefined}
        />
      ) : (
        <ElementIfCard
          step={step}
          stepIndex={stepIndex}
          packId={packId}
          menuId={menuId}
          elementId={elementId}
          stateIndex={stateIndex}
          clickType={clickType}
          frames={frames}
          focused={focused}
          onSelect={onSelect}
          onRemove={onRemove}
          onMoveLeft={stepIndex > 0 ? onMoveLeft : undefined}
          onMoveRight={!isLast ? onMoveRight : undefined}
        />
      )}
      {!isLast ? <Arrow /> : null}
    </>
  );
}

function ElementIfCard({
  step,
  stepIndex,
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  frames,
  focused,
  onSelect,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  step: Extract<Step, { kind: "if" }>;
  stepIndex: number;
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  frames: StepFrame[];
  focused: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const addIfCase = useAccountStore((s) => s.addIfCase);
  const removeIfCase = useAccountStore((s) => s.removeIfCase);
  const setIfCaseConditions = useAccountStore((s) => s.setIfCaseConditions);
  const setIfCaseJoin = useAccountStore((s) => s.setIfCaseJoin);
  return (
    <div
      className={cx(
        "flex flex-col rounded border bg-zinc-900/60",
        focused ? "border-emerald-500" : "border-zinc-700",
      )}
    >
      <CardHeader
        kind="if"
        label="branch"
        focused={focused}
        onSelect={onSelect}
        onRemove={onRemove}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
      />
      <div className="flex flex-col gap-1.5 p-2">
        {(() => {
          const totalCases = step.cases.length + (step.else ? 1 : 0);
          const autoCollapse = totalCases >= 3;
          return (
            <>
              {step.cases.map((c, ci) => (
                <CaseRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: case index stable per render
                  key={ci}
                  label={ci === 0 ? "if" : "else if"}
                  ifCase={c}
                  defaultCollapsed={autoCollapse && ci > 0}
                  childFrames={[...frames, { stepIndex, descend: { case: ci } }]}
                  // Only allow removing else-if cases — the first `if` case is the
                  // anchor of the if-step and removing it would leave a degenerate
                  // shape; users delete the whole if-step via the card × instead.
                  onRemoveCase={
                    ci > 0
                      ? () =>
                          removeIfCase({
                            packId,
                            menuId,
                            elementId,
                            appearanceIndex: stateIndex,
                            clickType,
                            frames,
                            ifStepIndex: stepIndex,
                            caseIndex: ci,
                          })
                      : undefined
                  }
                  onConditionsChange={(conditions) =>
                    setIfCaseConditions({
                      packId,
                      menuId,
                      elementId,
                      appearanceIndex: stateIndex,
                      clickType,
                      frames,
                      ifStepIndex: stepIndex,
                      caseIndex: ci,
                      conditions,
                    })
                  }
                  onJoinChange={(joinIndex, op) =>
                    setIfCaseJoin({
                      packId,
                      menuId,
                      elementId,
                      appearanceIndex: stateIndex,
                      clickType,
                      frames,
                      ifStepIndex: stepIndex,
                      caseIndex: ci,
                      joinIndex,
                      op,
                    })
                  }
                  renderSteps={(steps, childFrames) => (
                    <ElementStepFlow
                      packId={packId}
                      menuId={menuId}
                      elementId={elementId}
                      stateIndex={stateIndex}
                      clickType={clickType}
                      steps={steps}
                      frames={childFrames}
                    />
                  )}
                />
              ))}
              {step.else ? (
                <CaseRow
                  label="else"
                  defaultCollapsed={autoCollapse}
                  childFrames={[...frames, { stepIndex, descend: "else" }]}
                  onRemoveCase={() =>
                    useAccountStore.getState().toggleIfElse({
                      packId,
                      menuId,
                      elementId,
                      appearanceIndex: stateIndex,
                      clickType,
                      frames,
                      ifStepIndex: stepIndex,
                      enabled: false,
                    })
                  }
                  renderSteps={(_steps, childFrames) => (
                    <ElementStepFlow
                      packId={packId}
                      menuId={menuId}
                      elementId={elementId}
                      stateIndex={stateIndex}
                      clickType={clickType}
                      steps={step.else!}
                      frames={childFrames}
                    />
                  )}
                />
              ) : null}
            </>
          );
        })()}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() =>
              addIfCase({
                packId,
                menuId,
                elementId,
                appearanceIndex: stateIndex,
                clickType,
                frames,
                ifStepIndex: stepIndex,
              })
            }
            className="rounded border border-zinc-700 border-dashed px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            + else if
          </button>
          {!step.else ? (
            <ToggleElseButton
              packId={packId}
              menuId={menuId}
              elementId={elementId}
              stateIndex={stateIndex}
              clickType={clickType}
              frames={frames}
              ifStepIndex={stepIndex}
              enabled={false}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToggleElseButton({
  packId,
  menuId,
  elementId,
  stateIndex,
  clickType,
  frames,
  ifStepIndex,
  enabled,
}: {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  clickType: ClickType;
  frames: StepFrame[];
  ifStepIndex: number;
  enabled: boolean;
}) {
  const toggleIfElse = useAccountStore((s) => s.toggleIfElse);
  return (
    <button
      type="button"
      onClick={() =>
        toggleIfElse({
          packId,
          menuId,
          elementId,
          appearanceIndex: stateIndex,
          clickType,
          frames,
          ifStepIndex,
          enabled: !enabled,
        })
      }
      className="rounded border border-zinc-700 border-dashed px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
    >
      + else
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card primitives shared by element and command flows
// ────────────────────────────────────────────────────────────────────────────

function ActionCard({
  action,
  focused,
  packId,
  onSelect,
  onRemove,
  onActionChange,
  onMoveLeft,
  onMoveRight,
}: {
  action: Action;
  focused: boolean;
  packId: PackId;
  onSelect: () => void;
  onRemove: () => void;
  /** When provided, render the per-type editor inline on the card. */
  onActionChange?: (next: Action) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  return (
    <div
      className={cx(
        "group flex w-[240px] flex-col rounded border transition-colors",
        focused ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900",
      )}
    >
      <CardHeader
        kind="action"
        label={actionTypeLabel(action.type)}
        focused={focused}
        onSelect={onSelect}
        onRemove={onRemove}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
      />
      {onActionChange ? (
        <div className="p-2">
          <ActionEditor packId={packId} action={action} onChange={onActionChange} />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="px-2 py-1 text-left font-mono text-[11px] text-zinc-200"
        >
          {actionSummary(action)}
        </button>
      )}
    </div>
  );
}

function CardHeader({
  kind,
  label,
  focused,
  onSelect,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  kind: "action" | "if";
  label: string;
  focused: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  return (
    <div
      className={cx(
        "group/header flex items-center gap-1 border-b px-2 py-0.5",
        focused ? "border-emerald-700/50 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cx(
          "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide",
          kind === "if" ? "bg-blue-500/20 text-blue-200" : "bg-zinc-800 text-zinc-300",
        )}
      >
        {label}
      </button>
      <div className="flex flex-1 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100">
        <RowIconButton title="Move left" disabled={!onMoveLeft} onClick={onMoveLeft}>
          ←
        </RowIconButton>
        <RowIconButton title="Move right" disabled={!onMoveRight} onClick={onMoveRight}>
          →
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
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
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

function Arrow() {
  return (
    <div className="flex shrink-0 items-center text-zinc-700">
      <span className="font-mono text-xs">→</span>
    </div>
  );
}

function EmptyChainHint() {
  return <div className="flex items-center text-[10px] text-zinc-600 italic">(empty chain)</div>;
}

function CaseRow({
  label,
  ifCase,
  childFrames,
  renderSteps,
  onRemoveCase,
  onConditionsChange,
  onJoinChange,
  defaultCollapsed = false,
}: {
  label: string;
  ifCase?: IfCase;
  childFrames: StepFrame[];
  renderSteps: (steps: Step[], childFrames: StepFrame[]) => React.ReactNode;
  /** Optional × button on the row header. Provided for else-if/else cases. */
  onRemoveCase?: () => void;
  /**
   * When provided, render an inline ConditionListEditor for the case's
   * conditions right inside the row — so users don't have to find the
   * properties pane to edit them.
   */
  onConditionsChange?: (conditions: Condition[]) => void;
  /** When provided, expose per-joiner AND/OR toggles on the inline editor. */
  onJoinChange?: (joinIndex: number, op: "and" | "or") => void;
  /** Initial collapse state. Useful when the parent has many cases. */
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const stepCount = ifCase?.steps.length ?? 0;
  const conditionsSummary = ifCase
    ? ifCase.conditions.length === 0
      ? "(always)"
      : ifCase.conditions
          .map((c, i) => {
            const op = (ifCase.joins?.[i - 1] ?? "and").toUpperCase();
            return i === 0 ? conditionSummary(c) : ` ${op} ${conditionSummary(c)}`;
          })
          .join("")
    : null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-1.5">
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((v) => !v)}
          className="rounded px-1 font-mono text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-blue-200">
          {label}
        </span>
        {/* When collapsed, show a compact summary in the header so the user
            can see what's there without expanding. */}
        {collapsed ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
            {conditionsSummary ? `${conditionsSummary} · ` : ""}
            {stepCount} step{stepCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {onRemoveCase ? (
          <button
            type="button"
            title="Remove this case"
            onClick={onRemoveCase}
            className={cx(
              "rounded px-1 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200",
              collapsed ? "" : "ml-auto",
            )}
          >
            ×
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <>
          {ifCase && onConditionsChange ? (
            <div className="mb-2">
              <ConditionListEditor
                label=""
                conditions={ifCase.conditions}
                onChange={onConditionsChange}
                emptyHint="(always — drop a condition here to gate this case)"
                joins={ifCase.joins}
                onJoinChange={onJoinChange}
              />
            </div>
          ) : null}
          <div className="overflow-x-auto">{renderSteps(ifCase?.steps ?? [], childFrames)}</div>
        </>
      ) : null}
    </div>
  );
}

function AddStepPicker({
  firstMenuId,
  onPick,
}: {
  firstMenuId: MenuId | undefined;
  onPick: (step: Step) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="self-stretch rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          + Add
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
        {ACTION_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            onSelect={() => onPick({ kind: "action", action: defaultAction(type, firstMenuId) })}
            className="cursor-pointer focus:bg-zinc-800"
          >
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-300">
              {actionTypeLabel(type)}
            </span>
            <span className="font-mono text-[11px] text-zinc-200">{type}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() =>
            onPick({
              kind: "if",
              cases: [{ conditions: [], steps: [] }],
            })
          }
          className="cursor-pointer focus:bg-zinc-800"
        >
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-blue-200">
            if
          </span>
          <span className="font-mono text-[11px] text-zinc-200">if branch</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClickTypePicker({
  label,
  options,
  onPick,
}: {
  label: string;
  options: ClickType[];
  onPick: (clickType: ClickType) => void;
}) {
  if (options.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="self-start rounded border border-zinc-700 border-dashed px-2 py-1.5 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt}
            onSelect={() => onPick(opt)}
            className="cursor-pointer font-mono text-[11px] focus:bg-zinc-800"
          >
            {clickTypeLabel(opt)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function framesEqual(a: StepFrame[], b: StepFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const fa = a[i]!;
    const fb = b[i]!;
    if (fa.stepIndex !== fb.stepIndex) return false;
    if (fa.descend === "else") {
      if (fb.descend !== "else") return false;
    } else {
      if (fb.descend === "else") return false;
      if (fa.descend.case !== fb.descend.case) return false;
    }
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Command flow
// ────────────────────────────────────────────────────────────────────────────

function CommandFlow({ packId, command }: { packId: PackId; command: Command }) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="font-mono text-xs text-zinc-200">/{command.name}</div>
        <div className="text-[10px] text-zinc-500">
          {command.permission ? `perm: ${command.permission} · ` : ""}
          step tree
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <CommandStepFlow
            packId={packId}
            commandId={command.id}
            steps={command.steps}
            frames={[]}
          />
        </div>
      </div>
    </div>
  );
}

function CommandStepFlow({
  packId,
  commandId,
  steps,
  frames,
}: {
  packId: PackId;
  commandId: CommandId;
  steps: Step[];
  frames: StepFrame[];
}) {
  const addCommandStep = useAccountStore((s) => s.addCommandStep);
  const setSub = useFlowSelectionStore((s) => s.set);
  const firstMenuId = useAccountStore(
    (s) => s.account.packs.find((p) => p.id === packId)?.menus[0]?.id,
  );
  const handleAdd = (newStep: Step) => {
    const newIndex = steps.length;
    addCommandStep({ packId, commandId, frames, index: newIndex, step: newStep });
    setSub({ kind: "step", path: { frames, index: newIndex } });
  };
  return (
    <div className="flex items-stretch gap-2">
      {steps.length === 0 ? (
        <EmptyChainHint />
      ) : (
        steps.map((step, i) => (
          <CommandStepNode
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
            key={i}
            step={step}
            stepIndex={i}
            isLast={i === steps.length - 1}
            packId={packId}
            commandId={commandId}
            frames={frames}
          />
        ))
      )}
      <AddStepPicker firstMenuId={firstMenuId} onPick={handleAdd} />
    </div>
  );
}

function CommandStepNode({
  step,
  stepIndex,
  isLast,
  packId,
  commandId,
  frames,
}: {
  step: Step;
  stepIndex: number;
  isLast: boolean;
  packId: PackId;
  commandId: CommandId;
  frames: StepFrame[];
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const removeCommandStep = useAccountStore((s) => s.removeCommandStep);
  const moveCommandStep = useAccountStore((s) => s.moveCommandStep);
  const setCommandStep = useAccountStore((s) => s.setCommandStep);

  const focused =
    sub?.kind === "step" &&
    sub.clickType === undefined &&
    sub.stateIndex === undefined &&
    framesEqual(sub.path.frames, frames) &&
    sub.path.index === stepIndex;

  const onSelect = () => setSub({ kind: "step", path: { frames, index: stepIndex } });
  const onRemove = () => {
    removeCommandStep({ packId, commandId, path: { frames, index: stepIndex } });
    if (focused) setSub(null);
  };
  const onMoveLeft = () =>
    moveCommandStep({ packId, commandId, frames, fromIndex: stepIndex, toIndex: stepIndex - 1 });
  const onMoveRight = () =>
    moveCommandStep({ packId, commandId, frames, fromIndex: stepIndex, toIndex: stepIndex + 1 });

  return (
    <>
      {step.kind === "action" ? (
        <ActionCard
          action={step.action}
          focused={focused}
          packId={packId}
          onSelect={onSelect}
          onRemove={onRemove}
          onActionChange={(next) =>
            setCommandStep({
              packId,
              commandId,
              path: { frames, index: stepIndex },
              step: { kind: "action", action: next },
            })
          }
          onMoveLeft={stepIndex > 0 ? onMoveLeft : undefined}
          onMoveRight={!isLast ? onMoveRight : undefined}
        />
      ) : (
        <CommandIfCard
          step={step}
          stepIndex={stepIndex}
          packId={packId}
          commandId={commandId}
          frames={frames}
          focused={focused}
          onSelect={onSelect}
          onRemove={onRemove}
          onMoveLeft={stepIndex > 0 ? onMoveLeft : undefined}
          onMoveRight={!isLast ? onMoveRight : undefined}
        />
      )}
      {!isLast ? <Arrow /> : null}
    </>
  );
}

function CommandIfCard({
  step,
  stepIndex,
  packId,
  commandId,
  frames,
  focused,
  onSelect,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  step: Extract<Step, { kind: "if" }>;
  stepIndex: number;
  packId: PackId;
  commandId: CommandId;
  frames: StepFrame[];
  focused: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const addCommandIfCase = useAccountStore((s) => s.addCommandIfCase);
  const toggleCommandIfElse = useAccountStore((s) => s.toggleCommandIfElse);
  const removeCommandIfCase = useAccountStore((s) => s.removeCommandIfCase);
  const setCommandIfCaseConditions = useAccountStore((s) => s.setCommandIfCaseConditions);
  const setCommandIfCaseJoin = useAccountStore((s) => s.setCommandIfCaseJoin);
  return (
    <div
      className={cx(
        "flex flex-col rounded border bg-zinc-900/60",
        focused ? "border-emerald-500" : "border-zinc-700",
      )}
    >
      <CardHeader
        kind="if"
        label="branch"
        focused={focused}
        onSelect={onSelect}
        onRemove={onRemove}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
      />
      <div className="flex flex-col gap-1.5 p-2">
        {(() => {
          const totalCases = step.cases.length + (step.else ? 1 : 0);
          const autoCollapse = totalCases >= 3;
          return (
            <>
              {step.cases.map((c, ci) => (
                <CaseRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: case index stable per render
                  key={ci}
                  label={ci === 0 ? "if" : "else if"}
                  ifCase={c}
                  defaultCollapsed={autoCollapse && ci > 0}
                  childFrames={[...frames, { stepIndex, descend: { case: ci } }]}
                  onRemoveCase={
                    ci > 0
                      ? () =>
                          removeCommandIfCase({
                            packId,
                            commandId,
                            frames,
                            ifStepIndex: stepIndex,
                            caseIndex: ci,
                          })
                      : undefined
                  }
                  onConditionsChange={(conditions) =>
                    setCommandIfCaseConditions({
                      packId,
                      commandId,
                      frames,
                      ifStepIndex: stepIndex,
                      caseIndex: ci,
                      conditions,
                    })
                  }
                  onJoinChange={(joinIndex, op) =>
                    setCommandIfCaseJoin({
                      packId,
                      commandId,
                      frames,
                      ifStepIndex: stepIndex,
                      caseIndex: ci,
                      joinIndex,
                      op,
                    })
                  }
                  renderSteps={(steps, childFrames) => (
                    <CommandStepFlow
                      packId={packId}
                      commandId={commandId}
                      steps={steps}
                      frames={childFrames}
                    />
                  )}
                />
              ))}
              {step.else ? (
                <CaseRow
                  label="else"
                  defaultCollapsed={autoCollapse}
                  childFrames={[...frames, { stepIndex, descend: "else" }]}
                  onRemoveCase={() =>
                    toggleCommandIfElse({
                      packId,
                      commandId,
                      frames,
                      ifStepIndex: stepIndex,
                      enabled: false,
                    })
                  }
                  renderSteps={(_, childFrames) => (
                    <CommandStepFlow
                      packId={packId}
                      commandId={commandId}
                      steps={step.else!}
                      frames={childFrames}
                    />
                  )}
                />
              ) : null}
            </>
          );
        })()}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => addCommandIfCase({ packId, commandId, frames, ifStepIndex: stepIndex })}
            className="rounded border border-zinc-700 border-dashed px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            + else if
          </button>
          {!step.else ? (
            <button
              type="button"
              onClick={() =>
                toggleCommandIfElse({
                  packId,
                  commandId,
                  frames,
                  ifStepIndex: stepIndex,
                  enabled: true,
                })
              }
              className="rounded border border-zinc-700 border-dashed px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              + else
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
