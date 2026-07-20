import { Badge } from "@/components/ui/badge";
import { newItemTemplateId } from "@/domain/ids";
import type { DataSource as DataSourceDomain, ItemTemplateId, Project, ProjectId } from "@/domain/types";
import type { ServerDataSource } from "@/lib/api/dataSources";

/**
 * Structural subset of ServerDataSource the sets tooling needs — lets the
 * project Data tab synthesize one for `pack:` sources (sets are not
 * server-only).
 */
export interface TemplatableSource {
  ref: string;
  schema: { name: string; type: string; description?: string | null }[];
  stability?: "static" | "dynamic" | null;
  keyField?: string | null;
}
// ServerDataSource is assignable to TemplatableSource (compile-time check).
const _assignable: TemplatableSource = undefined as unknown as ServerDataSource;
void _assignable;

/** Adapt a project (`pack:`) data source: sets are not server-only. Project
 *  data is static by nature; a table's Row key comes from its Data model.
 *  Config sources expose their top-level fields (iterable nested lists) but
 *  have no Row key — not placeable. */
export function packSourceToTemplatable(pack: Project, ds: DataSourceDomain): TemplatableSource {
  const models = pack.dataModels ?? [];
  const fields =
    ds.shape === "table" ? (models.find((m) => m.id === ds.modelId)?.fields ?? []) : ds.fields;
  return {
    ref: `pack:${ds.id}`,
    schema: fields.map((f) => ({ name: f.name, type: f.type.kind, description: null })),
    stability: "static",
    keyField:
      ds.shape === "table" ? (models.find((m) => m.id === ds.modelId)?.keyField ?? null) : null,
  };
}
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ItemTemplateEditor } from "./ItemTemplateEditor";
import { findSeedElement, seedTemplateFromElement, seedTemplateFromSchema } from "./itemTemplateSeed";

/**
 * "Sets d'items" section of a server source detail: lists the Item templates
 * bound to this source and hosts the "Créer un set d'items" flow. Creation
 * seeds from an element already consuming the source when one exists (full
 * fidelity — carries conditional states and click chains), else from the
 * declared schema (icon/name/price heuristics). Cf. ADR
 * `item-templates-and-data-library`.
 */
export function ItemTemplatesSection({
  projectId,
  source,
}: {
  projectId: ProjectId;
  source: TemplatableSource;
}) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const addItemTemplate = useAccountStore((s) => s.addItemTemplate);
  const removeItemTemplate = useAccountStore((s) => s.removeItemTemplate);
  const [editingId, setEditingId] = useState<ItemTemplateId | null>(null);

  if (!pack) return null;
  const templates = (pack.itemTemplates ?? []).filter((tpl) => tpl.sourceRef === source.ref);

  const createTemplate = () => {
    const id = newItemTemplateId();
    const base = {
      id,
      projectId,
      name: t("itemTemplates.defaultName", { source: source.ref.split(":").pop() }),
      sourceRef: source.ref,
      alias: "item",
      ...(source.keyField ? { keyField: source.keyField } : {}),
      // Auto-pick a grouping field when the schema has an obvious one.
      ...(source.stability === "static" &&
      source.schema.some((f) => f.name === "category" || f.name === "group")
        ? { groupBy: source.schema.find((f) => f.name === "category" || f.name === "group")!.name }
        : {}),
    };
    const seedEl = findSeedElement(pack, source.ref);
    const seed = seedEl
      ? seedTemplateFromElement(pack, seedEl.element, base)
      : seedTemplateFromSchema(base, pack.defaultLang, source.schema);
    addItemTemplate({ projectId, template: seed.template, i18n: seed.i18n });
    toast.success(
      seedEl
        ? t("itemTemplates.createdFromElement", { menu: seedEl.menuId })
        : t("itemTemplates.createdFromSchema"),
    );
    setEditingId(id);
  };

  return (
    <section className="flex flex-col gap-2" data-testid="item-templates-section">
      <div className="eyebrow">{t("itemTemplates.sectionTitle")}</div>
      {templates.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)]">{t("itemTemplates.emptyHint")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="flex items-center gap-2 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">{tpl.name}</span>
              <Badge>{tpl.alias}</Badge>
              {tpl.groupBy ? (
                <Badge>{t("itemTemplates.groupedBy", { field: tpl.groupBy })}</Badge>
              ) : null}
              <button
                type="button"
                data-testid={`edit-template-${tpl.id}`}
                onClick={() => setEditingId(tpl.id)}
                className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                {t("itemTemplates.edit")}
              </button>
              <button
                type="button"
                title={t("itemTemplates.remove")}
                data-testid={`remove-template-${tpl.id}`}
                onClick={() => removeItemTemplate({ projectId, templateId: tpl.id })}
                className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          data-testid="create-item-template"
          onClick={createTemplate}
          className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)] hover:bg-[var(--brand)]/20"
        >
          {t("itemTemplates.create")}
        </button>
      </div>
      {editingId ? (
        <ItemTemplateEditor
          projectId={projectId}
          source={source}
          templateId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </section>
  );
}
