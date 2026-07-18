import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  Appearance,
  ElementId,
  I18nKey,
  ItemTemplateId,
  MenuId,
  Project,
  ProjectId,
} from "@/domain/types";
import { resolveDisplayRef } from "@/domain/capturedItems";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
import { headPreviewUrl } from "@/features/canvas/headTexture";
import { ElementClickHandlersPseudocode } from "@/features/flow/PseudocodeView";
import { moduleLocalRows, renderPreview } from "@/features/canvas/menuPreviewScope";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { getText } from "@/lib/i18n";
import type { ServerDataSource } from "@/lib/api/dataSources";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Modal editor of one Item template — THE place a row's look AND click
 * behavior are defined. Editing propagates to every menu bound to this
 * template (banner says so). Per-state: material / count / title / lore,
 * visibility conditions, and the full click-handlers pseudocode editor
 * (template-addressed reducers). Live preview renders state 0 against the
 * first snapshot row when the server has one.
 */
/**
 * Material preview tile of one template state: renders the resolved material
 * (placeholders resolved against the first live row) as a real item icon, and
 * doubles as a MaterialPicker trigger — picking writes a static material.
 */
function StateMaterialTile({
  pack,
  material,
  previewCtx,
  activeLang,
  onPick,
}: {
  pack: Project;
  material: string;
  previewCtx: Record<string, unknown>;
  activeLang: string;
  onPick: (material: string) => void;
}) {
  const rendered = material ? renderPreview(material, previewCtx, pack, activeLang) : "";
  // Captured-item refs expand to their display descriptor (custom ref / head).
  const display = resolveDisplayRef(pack, rendered);
  const resolved = display.material;
  const materialUrl = useTextureUrl(resolved);
  const textureUrl = headPreviewUrl(display.head) ?? materialUrl;
  return (
    <MaterialPicker
      projectId={pack.id}
      trigger={
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--brand)]"
        >
          {textureUrl ? (
            <img
              src={textureUrl}
              alt={resolved}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[8px] text-[var(--text-faint)]">{resolved.slice(0, 4) || "—"}</span>
          )}
        </button>
      }
      onPick={onPick}
    />
  );
}

export function ItemTemplateEditor({
  projectId,
  source,
  templateId,
  onClose,
}: {
  projectId: ProjectId;
  source: ServerDataSource;
  templateId: ItemTemplateId;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const updateItemTemplate = useAccountStore((s) => s.updateItemTemplate);
  const setItemTemplateAppearances = useAccountStore((s) => s.setItemTemplateAppearances);
  const setAppearanceConditions = useAccountStore((s) => s.setAppearanceConditions);
  const setAppearanceJoin = useAccountStore((s) => s.setAppearanceJoin);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const activeLang = useUiStore((s) => s.activeLang);

  // Live rows so the preview shows real data (loaded once per session; live wins).
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const loadSnapshot = useServerSnapshotsStore((s) => s.loadSnapshot);
  const snapshotRows = useServerSnapshotsStore((s) => s.rowsByRef[source.ref]);
  useEffect(() => {
    if (networkId && serverId) loadSnapshot({ networkId, serverId, ref: source.ref });
  }, [networkId, serverId, source.ref, loadSnapshot]);

  const tpl = pack?.itemTemplates?.find((x) => x.id === templateId);
  if (!pack || !tpl) return null;
  // Module-local rows (live authoring state) win over the server snapshot.
  const rows = moduleLocalRows(pack, source.ref) ?? snapshotRows;

  const patchAppearance = (index: number, patch: Partial<Appearance>) => {
    setItemTemplateAppearances({
      projectId,
      templateId,
      appearances: tpl.appearances.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    });
  };

  const addLore = (index: number) =>
    patchAppearance(index, { lore: { key: "" as I18nKey } });

  const previewRow = Array.isArray(rows) ? rows[0] : undefined;
  const previewCtx = previewRow ? { [tpl.alias]: previewRow } : {};
  const state0 = tpl.appearances[0];

  // Menu context for the click editor (placeholder resolution + action
  // defaults): the first element consuming this template, else the first menu.
  const consumer = (() => {
    for (const menu of pack.menus) {
      for (const layer of menu.layers) {
        for (const el of layer.elements) {
          if ((el.places?.templateId ?? el.iterates?.templateId) === templateId) {
            return { menuId: menu.id, elementId: el.id };
          }
        }
      }
    }
    return { menuId: pack.menus[0]?.id ?? ("" as MenuId), elementId: "" as ElementId };
  })();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("itemTemplates.editorTitle")}</DialogTitle>
        </DialogHeader>

        {/* Shared-template banner: edits reach every consuming menu. */}
        <div className="rounded border border-[var(--brand-line)] bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)]">
          {t("itemTemplates.sharedBanner")}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-[11px] text-[var(--text-mut)]">
              {t("itemTemplates.nameLabel")}
              <Input
                value={tpl.name}
                onChange={(e) =>
                  updateItemTemplate({ projectId, templateId, patch: { name: e.target.value } })
                }
                className="h-8 px-2 text-xs"
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-[11px] text-[var(--text-mut)]">
              {t("itemTemplates.aliasLabel")}
              <Input
                value={tpl.alias}
                onChange={(e) =>
                  updateItemTemplate({ projectId, templateId, patch: { alias: e.target.value } })
                }
                className="h-8 px-2 font-mono text-xs"
              />
            </label>
            {source.stability === "static" ? (
              <label className="flex w-36 flex-col gap-1 text-[11px] text-[var(--text-mut)]">
                {t("itemTemplates.groupByLabel")}
                <select
                  value={tpl.groupBy ?? ""}
                  onChange={(e) =>
                    updateItemTemplate({
                      projectId,
                      templateId,
                      patch: { groupBy: e.target.value || undefined },
                    })
                  }
                  className="h-8 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)]"
                >
                  <option value="">{t("itemTemplates.groupByNone")}</option>
                  {source.schema.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="text-[10px] text-[var(--text-faint)]">
            {t("itemTemplates.aliasHint", { example: `{${tpl.alias}.name}` })}
          </p>

          {/* States */}
          {tpl.appearances.map((app, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: state index is the identity
              key={i}
              className="flex flex-col gap-2 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                  {i === 0 ? t("itemTemplates.stateDefault") : t("itemTemplates.stateN", { index: i })}
                </span>
                {tpl.appearances.length > 1 && i > 0 ? (
                  <button
                    type="button"
                    title={t("itemTemplates.removeState")}
                    onClick={() =>
                      setItemTemplateAppearances({
                        projectId,
                        templateId,
                        appearances: tpl.appearances.filter((_, x) => x !== i),
                      })
                    }
                    className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] text-[var(--text-mut)]">
                  {t("itemTemplates.materialLabel")}
                  <div className="flex items-center gap-1.5">
                    {/* Preview tile (resolved against the first live row) — click
                        to pick a static material from the item library. */}
                    <StateMaterialTile
                      pack={pack}
                      material={app.material ?? ""}
                      previewCtx={previewCtx}
                      activeLang={activeLang}
                      onPick={(picked) => patchAppearance(i, { material: picked })}
                    />
                    <Input
                      value={app.material ?? ""}
                      placeholder={`{${tpl.alias}.icon}`}
                      onChange={(e) => patchAppearance(i, { material: e.target.value })}
                      className="h-7 min-w-0 flex-1 px-2 font-mono text-xs"
                    />
                  </div>
                </label>
                <label className="flex w-20 flex-col gap-1 text-[10px] text-[var(--text-mut)]">
                  {t("itemTemplates.countLabel")}
                  <Input
                    type="number"
                    min={1}
                    max={64}
                    value={app.count ?? 1}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1 && n <= 64) patchAppearance(i, { count: n });
                    }}
                    className="h-7 px-2 text-xs"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-[10px] text-[var(--text-mut)]">
                {t("itemTemplates.titleLabel", { lang: activeLang })}
                <Input
                  value={app.title ? getText(pack, app.title, activeLang) : ""}
                  placeholder={`{${tpl.alias}.name}`}
                  onChange={(e) => {
                    if (app.title)
                      setI18nValue({ projectId, lt: app.title, lang: activeLang, value: e.target.value });
                    else patchAppearance(i, { title: { key: "" as I18nKey } });
                  }}
                  className="h-7 px-2 font-mono text-xs"
                />
              </label>
              {app.lore ? (
                <label className="flex flex-col gap-1 text-[10px] text-[var(--text-mut)]">
                  {t("itemTemplates.loreLabel", { lang: activeLang })}
                  <textarea
                    value={getText(pack, app.lore, activeLang)}
                    rows={2}
                    onChange={(e) =>
                      setI18nValue({ projectId, lt: app.lore!, lang: activeLang, value: e.target.value })
                    }
                    className="textarea min-h-0 px-2 py-1 font-mono text-xs"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => addLore(i)}
                  className="self-start rounded border border-[var(--border)] border-dashed px-2 py-0.5 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                >
                  {t("itemTemplates.addLore")}
                </button>
              )}

              {/* Visibility conditions — same editor as the element panel. */}
              <div className="overflow-x-auto">
                <ConditionListEditor
                  label={t("flow.visibility")}
                  conditions={app.if ?? []}
                  joins={app.ifJoins}
                  emptyHint={
                    i === 0 ? t("flow.visibilityAlwaysDefault") : t("flow.visibilityAlways")
                  }
                  onChange={(conditions) =>
                    setAppearanceConditions({
                      projectId,
                      templateId,
                      appearanceIndex: i,
                      conditions,
                    })
                  }
                  onJoinChange={(joinIndex, op) =>
                    setAppearanceJoin({ projectId, templateId, appearanceIndex: i, joinIndex, op })
                  }
                />
              </div>

              {/* Click handlers — THE place a set's click behavior is defined
                  (the export inlines it into every consuming menu). */}
              <div className="mt-1">
                <div className="field-label">{t("flow.clickHandlers")}</div>
                <ElementClickHandlersPseudocode
                  projectId={projectId}
                  menuId={consumer.menuId}
                  elementId={consumer.elementId}
                  templateId={templateId}
                  stateIndex={i}
                  click={app.click}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setItemTemplateAppearances({
                projectId,
                templateId,
                appearances: [...tpl.appearances, { material: "", title: { key: "" as I18nKey } }],
              })
            }
            className="self-start rounded border border-[var(--border)] border-dashed px-2.5 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("itemTemplates.addState")}
          </button>

          {/* Live preview against the first snapshot row */}
          {state0 ? (
            <div className="rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] p-2">
              <div className="mb-1 text-[9px] uppercase text-[var(--text-faint)]">
                {previewRow
                  ? t("itemTemplates.previewLive")
                  : t("itemTemplates.previewPlaceholders")}
              </div>
              <div className="font-mono text-[10px] text-[var(--text-mut)]">
                {state0.material
                  ? renderPreview(state0.material, previewCtx, pack, activeLang)
                  : "—"}
              </div>
              <MiniMessageInline
                source={renderPreview(
                  state0.title ? getText(pack, state0.title, activeLang) : "",
                  previewCtx,
                  pack,
                  activeLang,
                )}
                className="block font-mono text-xs"
              />
              {state0.lore
                ? getText(pack, state0.lore, activeLang)
                    .split("\n")
                    .filter(Boolean)
                    .map((line, li) => (
                      <MiniMessageInline
                        // biome-ignore lint/suspicious/noArrayIndexKey: lines stable per render
                        key={li}
                        source={renderPreview(line, previewCtx, pack, activeLang)}
                        className="block font-mono text-[10px] text-[var(--text-mut)]"
                      />
                    ))
                : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
