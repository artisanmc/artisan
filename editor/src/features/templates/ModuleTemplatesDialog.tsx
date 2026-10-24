import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FileDiff } from "@/components/ui/file-diff";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { writeClipboard } from "@/features/canvas/clipboard";
import { copyTemplate, fetchTemplateFiles } from "@/lib/api/templates";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { pickable, templateClipboard, templateProject } from "./templateProject";
import type { TemplateFileState, TemplateState } from "./templateStates";
import { useProjectTemplates } from "./useProjectTemplates";

type View =
  | { kind: "file"; template: TemplateState; path: string }
  | { kind: "default"; template: TemplateState }
  | { kind: "conflict"; template: TemplateState; paths: string[] };

const keyOf = (t: TemplateState) => `${t.moduleId}/${t.template.id}`;

/**
 * The module templates of a Project (ADR `module-templates`): what each module offers, the
 * state of every file copied here, and the actions on them. A copy is written by the server
 * and never overwrites the owner's edits without asking; the default version is read-only,
 * its menus, items and commands copied to the clipboard to paste on the board.
 */
export function ModuleTemplatesDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const templates = useProjectTemplates(projectId);
  const baseline = useProjectBaselineStore((s) => s.baselines[projectId]);
  const [view, setView] = useState<View | null>(null);
  const [shipped, setShipped] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const filesOf = async (template: TemplateState): Promise<Record<string, string> | null> => {
    const key = keyOf(template);
    if (shipped[key]) return shipped[key];
    if (!templates.serverId) return null;
    const read = await fetchTemplateFiles(
      templates.serverId,
      template.moduleId,
      template.template.id,
    );
    if (!read.ok) {
      toast.error(
        t(`moduleTemplates.errors.${read.error}`, t("moduleTemplates.errors.fetch_error")),
      );
      return null;
    }
    setShipped((s) => ({ ...s, [key]: read.files }));
    return read.files;
  };

  const show = async (next: View) => {
    if (next.kind !== "conflict" && !(await filesOf(next.template))) return;
    setView(next);
  };

  const copy = async (template: TemplateState, paths: string[] | undefined, replace: boolean) => {
    if (!templates.target) return;
    setBusy(true);
    const result = await copyTemplate(templates.target, {
      module: template.moduleId,
      template: template.template.id,
      ...(paths ? { paths } : {}),
      replace,
    });
    setBusy(false);
    if (result.ok) {
      toast.success(
        t("moduleTemplates.copied", { count: result.written.length + result.unchanged.length }),
      );
      setView(null);
      templates.refresh();
    } else if (result.error === "conflict") {
      setView({ kind: "conflict", template, paths: result.conflicts });
    } else {
      toast.error(
        t(`moduleTemplates.errors.${result.error}`, t("moduleTemplates.errors.fetch_error")),
      );
    }
  };

  const writable = templates.target !== null && !templates.dirty && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("moduleTemplates.title")}</DialogTitle>
          <DialogDescription>{t("moduleTemplates.description")}</DialogDescription>
        </DialogHeader>
        {templates.dirty && (
          <p className="rounded-[10px] bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--text)]">
            {t("moduleTemplates.dirty")}
          </p>
        )}
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <TemplateList templates={templates} writable={writable} onShow={show} onCopy={copy} />
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden">
            {view === null ? (
              <EmptyState title={t("moduleTemplates.pick")} />
            ) : view.kind === "conflict" ? (
              <ConflictView
                view={view}
                writable={writable}
                onReplace={() => copy(view.template, view.paths, true)}
                onCancel={() => setView(null)}
              />
            ) : view.kind === "file" ? (
              <FileView
                view={view}
                shipped={shipped[keyOf(view.template)]?.[view.path] ?? ""}
                current={baseline?.[projectPathOf(view)]}
                writable={writable}
                onReset={() => copy(view.template, [view.path], true)}
              />
            ) : (
              <DefaultVersionView
                template={view.template}
                files={shipped[keyOf(view.template)] ?? {}}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateList({
  templates,
  writable,
  onShow,
  onCopy,
}: {
  templates: ReturnType<typeof useProjectTemplates>;
  writable: boolean;
  onShow: (view: View) => void;
  onCopy: (template: TemplateState, paths: string[] | undefined, replace: boolean) => void;
}) {
  const { t } = useTranslation();
  if (templates.status === "none") return <EmptyState title={t("moduleTemplates.none")} />;
  if (templates.status === "unsupported")
    return <EmptyState title={t("moduleTemplates.errors.plugin_update_required")} />;
  if (templates.status === "error")
    return <EmptyState title={t("moduleTemplates.errors.fetch_error")} />;
  if (templates.status === "loading") return <EmptyState title={t("moduleTemplates.loading")} />;
  // A module's system elements are in its folder already: nothing to copy.
  const offered = templates.states.filter((template) => !template.template.system);
  if (offered.length === 0) return <EmptyState title={t("moduleTemplates.none")} />;
  return (
    <>
      {offered.map((template) => {
        // Untouched copies of an older version: taking the new one loses nothing.
        const updatable = template.files.filter(
          (f) => f.updateAvailable && (f.status === "identical" || f.status === "removed"),
        );
        return (
          <section key={keyOf(template)} className="card flex flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[var(--text)]">
                  {template.template.title}
                </div>
                <div className="text-[11.5px] text-[var(--text-faint)]">
                  {t("moduleTemplates.byModule", {
                    module: template.moduleId,
                    version: template.template.version,
                  })}
                </div>
              </div>
              {template.updateAvailable ? (
                <Badge variant="amber">{t("moduleTemplates.updateAvailable")}</Badge>
              ) : template.copied ? (
                <Badge variant="sage">{t("moduleTemplates.added")}</Badge>
              ) : null}
            </div>
            <ul className="flex flex-col">
              {template.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  onShow={() => onShow({ kind: "file", template, path: file.path })}
                />
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {updatable.length > 0 ? (
                <Button
                  size="sm"
                  disabled={!writable}
                  onClick={() =>
                    onCopy(
                      template,
                      updatable.map((f) => f.path),
                      true,
                    )
                  }
                >
                  {t("moduleTemplates.update", { count: updatable.length })}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!writable || template.files.every((f) => f.status === "identical")}
                  onClick={() => onCopy(template, undefined, false)}
                >
                  {t("moduleTemplates.add")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onShow({ kind: "default", template })}
              >
                {t("moduleTemplates.openDefault")}
              </Button>
            </div>
          </section>
        );
      })}
    </>
  );
}

const STATUS_VARIANT = {
  absent: undefined,
  occupied: "brick",
  identical: "sage",
  modified: "terra",
  removed: "brick",
} as const;

function FileRow({ file, onShow }: { file: TemplateFileState; onShow: () => void }) {
  const { t } = useTranslation();
  const variant = STATUS_VARIANT[file.status];
  return (
    <li>
      <button
        type="button"
        onClick={onShow}
        className="flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[12px] hover:bg-[var(--surface-hover)]"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-mut)]">
          {file.projectPath}
        </span>
        {file.updateAvailable && <Badge variant="amber">{t("moduleTemplates.fileUpdate")}</Badge>}
        {variant ? (
          <Badge variant={variant}>{t(`moduleTemplates.status.${file.status}`)}</Badge>
        ) : (
          <span className="text-[11px] text-[var(--text-faint)]">
            {t("moduleTemplates.status.absent")}
          </span>
        )}
      </button>
    </li>
  );
}

function FileView({
  view,
  shipped,
  current,
  writable,
  onReset,
}: {
  view: { template: TemplateState; path: string };
  shipped: string;
  /** The published file, absent when the Project has none at that path. */
  current: string | undefined;
  writable: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const state = view.template.files.find((f) => f.path === view.path);
  const shownPath = state?.projectPath ?? view.path;
  const differs = current !== undefined && current !== shipped;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">
          {shownPath}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(shipped);
            toast.success(t("moduleTemplates.textCopied"));
          }}
        >
          {t("moduleTemplates.copyText")}
        </Button>
        {state && state.status !== "identical" && state.status !== "absent" && (
          <Button size="sm" disabled={!writable} onClick={onReset}>
            {t("moduleTemplates.reset")}
          </Button>
        )}
      </div>
      {state?.status === "modified" || state?.status === "occupied" ? (
        <p className="text-[11.5px] text-[var(--text-faint)]">{t("moduleTemplates.resetHint")}</p>
      ) : null}
      <Tabs defaultValue={differs ? "compare" : "shipped"} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="shipped">{t("moduleTemplates.shipped")}</TabsTrigger>
          <TabsTrigger value="compare" disabled={current === undefined}>
            {t("moduleTemplates.compare")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="shipped" className="min-h-0 flex-1 overflow-hidden">
          <YamlCodeEditor value={shipped} readOnly ariaLabel={view.path} height="50dvh" />
        </TabsContent>
        <TabsContent value="compare" className="min-h-0 flex-1 overflow-auto">
          <FileDiff
            before={current ?? ""}
            after={shipped}
            beforeLabel={t("moduleTemplates.inProject")}
            afterLabel={t("moduleTemplates.shipped")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConflictView({
  view,
  writable,
  onReplace,
  onCancel,
}: {
  view: { template: TemplateState; paths: string[] };
  writable: boolean;
  onReplace: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-[var(--text)]">
        {t("moduleTemplates.conflict", { count: view.paths.length })}
      </p>
      <ul className="flex flex-col gap-0.5">
        {view.paths.map((path) => (
          <li key={path} className="font-mono text-[12px] text-[var(--text-mut)]">
            {path}
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-[var(--text-faint)]">{t("moduleTemplates.resetHint")}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={!writable} onClick={onReplace}>
          {t("moduleTemplates.replace")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("moduleTemplates.cancel")}
        </Button>
      </div>
    </div>
  );
}

function DefaultVersionView({
  template,
  files,
}: { template: TemplateState; files: Record<string, string> }) {
  const { t } = useTranslation();
  const project = useMemo(
    () => templateProject(template.moduleId, template.template.id, files),
    [template.moduleId, template.template.id, files],
  );
  const choices = useMemo(() => pickable(project), [project]);
  const [menus, setMenus] = useState<string[]>([]);
  const [commands, setCommands] = useState<string[]>([]);
  const [elements, setElements] = useState<{ menuId: string; elementId: string }[]>([]);
  const toggle = <T,>(list: T[], item: T, same: (a: T) => boolean) =>
    list.some(same) ? list.filter((x) => !same(x)) : [...list, item];
  const count =
    menus.length + commands.length + elements.filter((e) => !menus.includes(e.menuId)).length;

  if (choices.menus.length === 0 && choices.commands.length === 0)
    return <EmptyState title={t("moduleTemplates.defaultEmpty")} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-[11.5px] text-[var(--text-faint)]">{t("moduleTemplates.defaultHint")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {choices.menus.map((menu) => (
          <div key={menu.id} className="flex flex-col py-1">
            <PickRow
              strong
              checked={menus.includes(menu.id)}
              onToggle={() => setMenus((m) => toggle(m, menu.id, (x) => x === menu.id))}
              label={t("moduleTemplates.menu", { id: menu.id })}
            />
            <div className="flex flex-col pl-6">
              {menu.elements.map((elementId) => {
                const same = (e: { menuId: string; elementId: string }) =>
                  e.menuId === menu.id && e.elementId === elementId;
                return (
                  <PickRow
                    key={elementId}
                    disabled={menus.includes(menu.id)}
                    checked={menus.includes(menu.id) || elements.some(same)}
                    onToggle={() =>
                      setElements((list) => toggle(list, { menuId: menu.id, elementId }, same))
                    }
                    label={elementId}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {choices.commands.map((id) => (
          <PickRow
            key={id}
            strong
            checked={commands.includes(id)}
            onToggle={() => setCommands((c) => toggle(c, id, (x) => x === id))}
            label={t("moduleTemplates.command", { id })}
          />
        ))}
      </div>
      <div>
        <Button
          size="sm"
          disabled={count === 0}
          onClick={async () => {
            await writeClipboard(templateClipboard(project, { menus, commands, elements }));
            toast.success(t("moduleTemplates.pickCopied", { count }));
          }}
        >
          {t("moduleTemplates.copyPick", { count })}
        </Button>
      </div>
    </div>
  );
}

function PickRow({
  label,
  checked,
  onToggle,
  disabled = false,
  strong = false,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders a native <input> inside this label; Biome cannot see through the component
    <label
      className={
        strong
          ? "flex items-center gap-2 py-0.5 text-[12.5px] font-medium text-[var(--text)]"
          : "flex items-center gap-2 text-[12px] text-[var(--text-mut)]"
      }
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      {label}
    </label>
  );
}

/** Where the file a view shows is, or would land, in the Project. */
function projectPathOf(view: { template: TemplateState; path: string }): string {
  return view.template.files.find((f) => f.path === view.path)?.projectPath ?? view.path;
}
