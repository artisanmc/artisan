import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { imageButtonRect } from "@/domain/imageButton";
import type { Element, Menu, ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { X } from "lucide-react";
import { useId, useState } from "react";
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

/** The rows of the chest a component is shown in. */
const ROWS = 3;

/**
 * The Project's components (ADR `element-parts-and-sliced-images`, decision 7): their list,
 * and the one selected opened alone, as a menu draws it at a size picked here, with its
 * parameters, its pieces (the panel of a button's pieces) and the buttons that name it.
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
  const [selected, setSelected] = useState<string | null>(null);
  const [created, setCreated] = useState("");
  const [positions, setPositions] = useState("0-2");
  const [error, setError] = useState("");
  const current = selected !== null && selected in files ? selected : (names[0] ?? null);
  const perform = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const store = () => useProjectsStore.getState();
  const file = current === null ? {} : readComponent(files[current]);
  const save = (next: ComponentFile) =>
    current !== null &&
    perform(() =>
      store().writeComponent({ projectId, name: current, content: writeComponentFile(next) }),
    );
  const menu = { rows: ROWS, inventoryType: "chest" } as Menu;
  const element = { positions } as Element;
  const rect = imageButtonRect(positions, "chest", ROWS);
  const uses = current === null ? [] : componentUses(project, current);
  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 gap-4 p-3" data-testid="components-view">
      <div className="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto">
        <p className="text-xs text-[var(--text-mut)]">{t("components.hint")}</p>
        <ul className="flex flex-col gap-1" aria-label={t("components.list")}>
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-pressed={name === current}
                className={cx(
                  "chip w-full justify-start text-[12px]",
                  name === current && "is-active",
                )}
                onClick={() => setSelected(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
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
                setSelected(created);
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

      {current === null ? (
        <p className="text-sm text-[var(--text-mut)]">{t("components.empty")}</p>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-wrap gap-6 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <span className="field-label !mb-0">{t("components.preview", { name: current })}</span>
            <ComponentPreview
              project={project}
              component={current}
              positions={positions}
              rows={ROWS}
            />
            <p className="text-xs text-[var(--text-mut)]">
              {t("components.previewHint", { width: rect?.width ?? 1, height: rect?.height ?? 1 })}
            </p>
          </div>

          <div className="flex w-80 flex-col gap-5">
            <ParamsEditor file={file} onChange={save} />
            <PartsEditor
              projectId={projectId}
              menu={menu}
              element={element}
              appearance={partsLook(file)}
              lang={lang}
              textOf={(text) => partText(file, text, lang)}
              onEdit={(op) => {
                if (op.type === "addImage" && op.positions) setPositions(op.positions);
                save(editComponentParts(file, op, lang));
              }}
              onPositions={setPositions}
            />
            <div className="flex flex-col gap-1">
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
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={uses.length > 0}
              title={uses.length > 0 ? t("components.deleteUsed") : undefined}
              onClick={() =>
                perform(() => store().writeComponent({ projectId, name: current, content: null }))
              }
            >
              {t("components.delete")}
            </Button>
          </div>
        </div>
      )}
    </div>
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
