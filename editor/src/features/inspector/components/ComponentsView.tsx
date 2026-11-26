import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { imageButtonRect } from "@/domain/imageButton";
import type { Element, Menu, ProjectId } from "@/domain/types";
import { StudioFrame } from "@/features/assets/StudioFrame";
import { TEX_SCALE } from "@/features/canvas/menuLayout";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PartsEditor } from "../element/PartsEditor";
import { ComponentPreview } from "./ComponentPreview";
import {
  type ComponentFile,
  componentUses,
  editComponentParts,
  partText,
  partsLook,
  projectComponents,
  readComponent,
  setComponentParam,
  writeComponentFile,
} from "./componentFile";

/** The rows of the chest a component is shown in: the tallest, so one of six rows fits. */
const ROWS = 6;

const SECTION = "flex flex-col gap-2 border-b border-[var(--border-soft)] px-3 py-3";

/** How far a piece may be set from its anchor: an image's limit, and a text's. */
const limitOf = (part: unknown) =>
  typeof (part as { image?: unknown } | null)?.image === "string" ? 4096 : 256;

/**
 * The Project's components (ADR `element-parts-and-sliced-images`, decision 7). Their list
 * first; the one opened takes the page, laid out as the atelier is (`StudioFrame`): the
 * component in a menu in the middle, at a size picked here, and on the right its pieces (the
 * panel of a button's pieces, in place of an image's layers), its parameters and the buttons
 * that name it. The piece in hand is dragged on the menu, or nudged with the arrow keys. A
 * change is written to the draft as it is made, as the rest of a Project is: the Project's
 * undo takes it back.
 */
export function ComponentsView({
  projectId,
  onOpenMenu,
}: {
  projectId: ProjectId;
  onOpenMenu?: (projectId: string, menuId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const lang = useUiStore((s) => s.activeLang);
  const files = projectComponents(project);
  const names = Object.keys(files).sort();
  const [opened, setOpened] = useState<string | null>(null);
  const [piece, setPiece] = useState<number | null>(null);
  const [created, setCreated] = useState("");
  const [positions, setPositions] = useState("0-2");
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; left: number; top: number; paused: boolean } | null>(
    null,
  );
  // A drag left unfinished (the page closed under the pointer) gives the history back.
  useEffect(
    () => () => {
      if (drag.current?.paused) useProjectsStore.temporal.getState().resume();
    },
    [],
  );
  const current = opened !== null && opened in files ? opened : null;
  const open = (name: string | null) => {
    setOpened(name);
    setPiece(null);
    setError("");
  };
  const perform = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const store = () => useProjectsStore.getState();
  if (!project) return null;

  if (current === null) {
    return (
      <div
        className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
        data-testid="components-view"
      >
        <p className="max-w-xl text-xs text-[var(--text-mut)]">{t("components.hint")}</p>
        {names.length === 0 ? (
          <p className="text-sm text-[var(--text-mut)]">{t("components.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("components.list")}>
            {names.map((name) => (
              <li key={name}>
                <button type="button" className="chip text-[12px]" onClick={() => open(name)}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex max-w-sm items-end gap-2">
          <label className="field-label !mb-0 flex-1" htmlFor={`${id}-new`}>
            {t("components.newName")}
            <Input
              id={`${id}-new`}
              value={created}
              placeholder="confirm"
              onChange={(event) => setCreated(event.target.value.trim().toLowerCase())}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!created}
            onClick={() =>
              perform(() => {
                store().writeComponent({
                  projectId,
                  name: created,
                  content: writeComponentFile({ parts: [] }),
                  create: true,
                });
                open(created);
                setCreated("");
              })
            }
          >
            {t("components.create")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    );
  }

  const file = readComponent(files[current]);
  const save = (next: ComponentFile) =>
    perform(() =>
      store().writeComponent({ projectId, name: current, content: writeComponentFile(next) }),
    );
  const menu = { rows: ROWS, inventoryType: "chest" } as Menu;
  const element = { positions } as Element;
  const rect = imageButtonRect(positions, "chest", ROWS);
  const uses = componentUses(project, current);
  const count = file.parts?.length ?? 0;
  // The piece the pointer moves: the one picked in the list, else the one in front.
  const held = count === 0 ? null : piece !== null && piece < count ? piece : count - 1;
  const heldPart = held === null ? undefined : (file.parts?.[held] as Record<string, unknown>);
  const offsetOf = (axis: "offset_x" | "offset_y") =>
    typeof heldPart?.[axis] === "number" ? (heldPart[axis] as number) : 0;
  /** Sets the piece in hand at `x`, `y` from its anchor, in the game's pixels. */
  const place = (x: number, y: number) => {
    if (held === null) return;
    const limit = limitOf(heldPart);
    const within = (value: number) => Math.max(-limit, Math.min(limit, Math.round(value)));
    save(
      editComponentParts(
        file,
        {
          type: "patch",
          index: held,
          patch: { offset_x: within(x) || undefined, offset_y: within(y) || undefined },
        },
        lang,
      ),
    );
  };
  const release = () => {
    if (drag.current?.paused) useProjectsStore.temporal.getState().resume();
    drag.current = null;
  };

  return (
    <StudioFrame
      back={t("components.back")}
      onBack={() => open(null)}
      title={current}
      subtitle={`${t("components.shownOn", { width: rect?.width ?? 1, height: rect?.height ?? 1 })} · ${t("components.uses", { count: uses.length })}`}
      parts={{
        rail: null,
        controls: null,
        actions: error ? (
          <span role="alert" className="max-w-xs text-xs text-[var(--danger)]">
            {error}
          </span>
        ) : null,
        preview: null,
        status: <span>{t(count === 0 ? "components.noPiece" : "components.dragHint")}</span>,
        stage: (
          <div
            className="checker flex min-h-0 flex-1 overflow-auto p-4"
            data-testid="components-view"
          >
            <div className="relative m-auto shrink-0">
              <ComponentPreview
                project={project}
                component={current}
                positions={positions}
                rows={ROWS}
              />
              {held !== null ? (
                <button
                  type="button"
                  aria-label={t("components.drag")}
                  data-testid="component-drag"
                  className="absolute inset-0 cursor-move touch-none border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)]"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.currentTarget.focus();
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    drag.current = {
                      x: event.clientX,
                      y: event.clientY,
                      left: offsetOf("offset_x"),
                      top: offsetOf("offset_y"),
                      paused: false,
                    };
                  }}
                  onPointerMove={(event) => {
                    const dragged = drag.current;
                    if (!dragged) return;
                    place(
                      dragged.left + Math.round((event.clientX - dragged.x) / TEX_SCALE),
                      dragged.top + Math.round((event.clientY - dragged.y) / TEX_SCALE),
                    );
                    // One drag is one step to undo: the first move is recorded, the rest is not.
                    if (!dragged.paused) {
                      useProjectsStore.temporal.getState().pause();
                      dragged.paused = true;
                    }
                  }}
                  onPointerUp={release}
                  onPointerCancel={release}
                  onKeyDown={(event) => {
                    const by: Record<string, [number, number]> = {
                      ArrowLeft: [-1, 0],
                      ArrowRight: [1, 0],
                      ArrowUp: [0, -1],
                      ArrowDown: [0, 1],
                    };
                    const delta = by[event.key];
                    if (!delta) return;
                    event.preventDefault();
                    place(offsetOf("offset_x") + delta[0], offsetOf("offset_y") + delta[1]);
                  }}
                />
              ) : null}
            </div>
          </div>
        ),
        panels: (
          <>
            <section className={SECTION}>
              <PartsEditor
                projectId={projectId}
                menu={menu}
                element={element}
                appearance={partsLook(file)}
                lang={lang}
                textOf={(text) => partText(file, text, lang)}
                onEdit={(op) => {
                  if (op.type === "addImage" && op.positions) setPositions(op.positions);
                  // The list changes: the piece in hand is the one in front again.
                  if (op.type !== "patch" && op.type !== "text") setPiece(null);
                  save(editComponentParts(file, op, lang));
                }}
                onPositions={setPositions}
                selected={held}
                onSelect={setPiece}
              />
            </section>
            <section className={SECTION}>
              <ParamsEditor file={file} onChange={save} />
            </section>
            <section className={SECTION}>
              <span className="field-label !mb-0">
                {t("components.uses", { count: uses.length })}
              </span>
              {uses.length === 0 ? (
                <p className="text-xs text-[var(--text-mut)]">{t("components.unused")}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {uses.map((use) => (
                    <li key={`${use.menuId}:${use.elementId}`}>
                      <button
                        type="button"
                        className="text-left text-xs text-[var(--brand)] hover:underline"
                        onClick={() => onOpenMenu?.(projectId, use.menuId)}
                      >
                        {use.menuId} · {use.elementId}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                disabled={uses.length > 0}
                title={uses.length > 0 ? t("components.deleteUsed") : undefined}
                onClick={() =>
                  perform(() => {
                    store().writeComponent({ projectId, name: current, content: null });
                    open(null);
                  })
                }
              >
                {t("components.delete")}
              </Button>
            </section>
          </>
        ),
      }}
    />
  );
}

/** The parameters a component takes: a name, a text or an image, and what it is by default. */
function ParamsEditor({
  file,
  onChange,
}: { file: ComponentFile; onChange: (file: ComponentFile) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const params = Object.entries(file.params ?? {});
  const valid = /^[a-z][a-z0-9_]*$/.test(name) && name !== "name" && !(name in (file.params ?? {}));
  return (
    <div className="flex flex-col gap-2">
      <span className="field-label !mb-0">{t("components.params")}</span>
      <p className="text-xs text-[var(--text-mut)]">{t("components.paramsHint")}</p>
      {params.map(([param, raw]) => {
        const type = raw?.type === "image" ? "image" : "text";
        const fallback = typeof raw?.default === "string" ? raw.default : "";
        return (
          <div key={param} className="flex items-end gap-2" data-testid="component-param">
            <span className="w-20 shrink-0 truncate pb-2 font-mono text-xs">{`{${param}}`}</span>
            <select
              className="input w-24"
              aria-label={t("components.paramType", { name: param })}
              value={type}
              onChange={(event) =>
                onChange(
                  setComponentParam(file, param, {
                    type: event.target.value as "text" | "image",
                    default: fallback,
                  }),
                )
              }
            >
              <option value="text">{t("components.text")}</option>
              <option value="image">{t("components.image")}</option>
            </select>
            <Input
              className="flex-1"
              aria-label={t("components.paramDefault", { name: param })}
              placeholder={t("components.default")}
              value={fallback}
              onChange={(event) =>
                onChange(setComponentParam(file, param, { type, default: event.target.value }))
              }
            />
            <button
              type="button"
              aria-label={t("components.paramRemove", { name: param })}
              className="flex h-8 w-7 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              onClick={() => onChange(setComponentParam(file, param, null))}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <div className="flex items-end gap-2">
        <label className="field-label !mb-0 flex-1" htmlFor={`${id}-param`}>
          {t("components.paramNew")}
          <Input
            id={`${id}-param`}
            value={name}
            placeholder="text"
            onChange={(event) => setName(event.target.value.trim().toLowerCase())}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!valid}
          onClick={() => {
            onChange(setComponentParam(file, name, { type: "text" }));
            setName("");
          }}
        >
          {t("components.paramAdd")}
        </Button>
      </div>
    </div>
  );
}
