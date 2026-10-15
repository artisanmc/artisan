import { Input } from "@/components/ui/input";
import {
  type FieldEditTarget,
  sourceRootFields,
  wouldTypeCreateModelCycle,
} from "@/domain/dataModels";
import type {
  DataModel,
  DataModelId,
  ModelField,
  ModelFieldType,
  Project,
} from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Declared-schema editor for a Data model (table) or a config source's inline
 * fields. Field rows: rename (blur-commit), kind select (retype with data
 * migration — cf. applyFieldEdit), list element kind, nested object recursion,
 * model refs (cycle-guarded), remove. ADR `project-sources-and-data-models`.
 */

const SCALAR_KINDS = [
  "string",
  "ltext",
  "minimessage",
  "minimessage_multiline",
  "number",
  "integer",
  "boolean",
  "item",
  "actions",
  "conditions",
] as const;
type KindChoice = (typeof SCALAR_KINDS)[number] | "list" | "object" | "model" | "map" | "enum" | "union";

function kindOf(t: ModelFieldType): KindChoice {
  // `document_ref` is declared by modules (ADR extensible-document-kinds), not
  // authored here: the field editor shows it as the string id it stores.
  return t.kind === "document_ref" ? "string" : t.kind;
}

function defaultTypeForKind(kind: KindChoice, models: DataModel[]): ModelFieldType {
  switch (kind) {
    case "list":
      return { kind: "list", of: { kind: "string" } };
    case "object":
      return { kind: "object", fields: [] };
    case "model":
      return { kind: "model", ref: (models[0]?.id ?? "") as DataModelId };
    case "map":
      return { kind: "map", of: { kind: "string" } };
    case "enum":
      return { kind: "enum", values: ["option_1"] };
    case "union":
      return { kind: "union", tag: "type", variants: [{ name: "variant_1", fields: [] }] };
    default:
      return { kind };
  }
}

function KindSelect({
  value,
  onChange,
  allowComplex,
  labelFor,
}: {
  value: KindChoice;
  onChange: (k: KindChoice) => void;
  allowComplex: boolean;
  labelFor: (k: KindChoice) => string;
}) {
  const kinds: KindChoice[] = allowComplex
    ? [...SCALAR_KINDS, "list", "object", "model", "map", "enum", "union"]
    : [...SCALAR_KINDS, "object", "model", "map", "enum", "union"];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as KindChoice)}
      className="input h-7 w-auto px-1 font-mono text-[11px]"
    >
      {kinds.map((k) => (
        <option key={k} value={k}>
          {labelFor(k)}
        </option>
      ))}
    </select>
  );
}

/** Comma-separated enum values, blur-commit (dedup, empties dropped). */
function EnumValuesEditor({
  values,
  onCommit,
}: {
  values: string[];
  onCommit: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(values.join(", "));
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = [...new Set(draft.split(",").map((v) => v.trim()).filter(Boolean))];
        if (next.length === 0) {
          setDraft(values.join(", "));
          return;
        }
        onCommit(next);
        setDraft(next.join(", "));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder={t("dataSources.enumValuesPlaceholder")}
      className="h-7 min-w-40 px-2 font-mono text-[11px]"
      aria-label={t("dataSources.enumValues")}
    />
  );
}

/**
 * Compact union shape editor: tag name, variants (rename/add/remove), and each
 * variant's fields (name + kind — scalars and list-of-scalar; deeper nesting
 * inside admin-authored variants is deferred, declared models can still carry
 * it and the value form renders any depth). Commits whole-type retypes — the
 * store's field-edit path engine doesn't traverse unions.
 */
function UnionShapeEditor({
  type,
  models,
  onCommit,
  labelFor,
}: {
  type: Extract<ModelFieldType, { kind: "union" }>;
  models: DataModel[];
  onCommit: (t: ModelFieldType) => void;
  labelFor: (k: KindChoice) => string;
}) {
  const { t } = useTranslation();
  const commit = (patch: Partial<Extract<ModelFieldType, { kind: "union" }>>) =>
    onCommit({ ...type, ...patch });
  const patchVariant = (i: number, v: (typeof type.variants)[number]) =>
    commit({ variants: type.variants.map((x, j) => (j === i ? v : x)) });

  const VARIANT_FIELD_KINDS: KindChoice[] = [...SCALAR_KINDS, "list"];

  return (
    <div className="ml-4 flex flex-col gap-1.5 border-l border-[var(--border-soft)] pl-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--text-faint)]">{t("dataSources.unionTag")}</span>
        <Input
          defaultValue={type.tag}
          key={type.tag}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== type.tag) commit({ tag: v });
          }}
          className="h-6 w-24 px-2 font-mono text-[11px]"
          aria-label={t("dataSources.unionTag")}
        />
      </div>
      {type.variants.map((variant, vi) => (
        <div key={variant.name} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Input
              defaultValue={variant.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== variant.name && !type.variants.some((x) => x.name === v))
                  patchVariant(vi, { ...variant, name: v });
              }}
              className="h-6 w-28 px-2 font-mono text-[11px]"
              aria-label={t("dataSources.variantName")}
            />
            <button
              type="button"
              onClick={() => commit({ variants: type.variants.filter((_, j) => j !== vi) })}
              className="rounded px-1 text-[10px] text-[var(--text-faint)] hover:text-rose-300"
              aria-label={t("dataSources.removeVariant", { name: variant.name })}
            >
              ✕
            </button>
          </div>
          <div className="ml-3 flex flex-col gap-1">
            {variant.fields.map((f, fi) => (
              <div key={f.name} className="flex items-center gap-1.5">
                <code className="min-w-24 text-[11px] text-[var(--text-mut)]">{f.name}</code>
                <KindSelect
                  value={f.type.kind === "list" ? "list" : (f.type.kind as KindChoice)}
                  allowComplex
                  labelFor={labelFor}
                  onChange={(k) => {
                    if (!VARIANT_FIELD_KINDS.includes(k)) return;
                    patchVariant(vi, {
                      ...variant,
                      fields: variant.fields.map((x, j) =>
                        j === fi ? { ...x, type: defaultTypeForKind(k, models) } : x,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    patchVariant(vi, { ...variant, fields: variant.fields.filter((_, j) => j !== fi) })
                  }
                  className="rounded px-1 text-[10px] text-[var(--text-faint)] hover:text-rose-300"
                  aria-label={t("dataSources.removeField", { name: f.name })}
                >
                  ✕
                </button>
              </div>
            ))}
            <VariantFieldAdder
              existing={variant.fields.map((f) => f.name)}
              onAdd={(name) =>
                patchVariant(vi, {
                  ...variant,
                  fields: [...variant.fields, { name, type: { kind: "string" } }],
                })
              }
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const name = `variant_${type.variants.length + 1}`;
          if (type.variants.some((v) => v.name === name)) return;
          commit({ variants: [...type.variants, { name, fields: [] }] });
        }}
        className="self-start rounded border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("dataSources.addVariant")}
      </button>
    </div>
  );
}

function VariantFieldAdder({ existing, onAdd }: { existing: string[]; onAdd: (name: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (v === "" || existing.includes(v)) return;
    onAdd(v);
    setDraft("");
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder={t("dataSources.fieldName")}
        className="h-6 w-28 px-2 font-mono text-[11px]"
      />
      <button
        type="button"
        onClick={commit}
        className="btn-ghost h-6 rounded px-2 text-[10px]"
        aria-label={t("dataSources.addField")}
      >
        {t("dataSources.addField")}
      </button>
    </div>
  );
}

function FieldRow({
  projectId,
  target,
  project,
  path,
  field,
  isKeyField,
}: {
  projectId: Project["id"];
  target: FieldEditTarget;
  project: Project;
  path: string[];
  field: ModelField;
  isKeyField: boolean;
}) {
  const { t } = useTranslation();
  const editSourceField = useAccountStore((s) => s.editSourceField);
  const [name, setName] = useState(field.name);
  const models = project.dataModels ?? [];

  const kindLabel = (k: KindChoice) => t(`dataSources.kind.${k}`);
  const commitRename = () => {
    const clean = name.trim();
    if (clean === "" || clean === field.name) {
      setName(field.name);
      return;
    }
    editSourceField({
      projectId,
      target,
      edit: { op: "rename", path, oldName: field.name, newName: clean },
    });
  };
  const retype = (newType: ModelFieldType) => {
    if (
      target.kind === "model" &&
      wouldTypeCreateModelCycle(models, target.modelId, newType)
    )
      return;
    editSourceField({ projectId, target, edit: { op: "retype", path, name: field.name, newType } });
  };

  const listElem = field.type.kind === "list" ? field.type.of : null;
  const mapElem = field.type.kind === "map" ? field.type.of : null;
  const nestedFields =
    field.type.kind === "object"
      ? field.type.fields
      : listElem?.kind === "object"
        ? listElem.fields
        : mapElem?.kind === "object"
          ? mapElem.fields
          : null;
  const nestedPath = [...path, field.name];

  return (
    <li className="flex flex-col gap-1" data-testid={`model-field-${field.name}`}>
      <div className="flex items-center gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-7 w-36 px-2 font-mono text-[12px]"
          aria-label={t("dataSources.fieldName")}
        />
        <KindSelect
          value={kindOf(field.type)}
          allowComplex
          labelFor={kindLabel}
          onChange={(k) => {
            if (k === kindOf(field.type)) return;
            retype(defaultTypeForKind(k, models));
          }}
        />
        {field.type.kind === "list" && listElem ? (
          <>
            <span className="text-[10px] text-[var(--text-faint)]">{t("dataSources.listOf")}</span>
            <KindSelect
              value={kindOf(listElem)}
              allowComplex={false}
              labelFor={kindLabel}
              onChange={(k) =>
                retype({ kind: "list", of: defaultTypeForKind(k, models) })
              }
            />
          </>
        ) : null}
        {field.type.kind === "model" ? (
          <select
            value={field.type.ref}
            onChange={(e) => retype({ kind: "model", ref: e.target.value as DataModelId })}
            className="input h-7 w-auto px-1 font-mono text-[11px]"
            aria-label={t("dataSources.pickModel")}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        {listElem?.kind === "model" ? (
          <select
            value={listElem.ref}
            onChange={(e) =>
              retype({ kind: "list", of: { kind: "model", ref: e.target.value as DataModelId } })
            }
            className="input h-7 w-auto px-1 font-mono text-[11px]"
            aria-label={t("dataSources.pickModel")}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        {field.type.kind === "map" && mapElem ? (
          <>
            <span className="text-[10px] text-[var(--text-faint)]">{t("dataSources.mapOf")}</span>
            <KindSelect
              value={kindOf(mapElem)}
              allowComplex={false}
              labelFor={kindLabel}
              onChange={(k) => retype({ kind: "map", of: defaultTypeForKind(k, models) })}
            />
            {mapElem.kind === "model" ? (
              <select
                value={mapElem.ref}
                onChange={(e) =>
                  retype({ kind: "map", of: { kind: "model", ref: e.target.value as DataModelId } })
                }
                className="input h-7 w-auto px-1 font-mono text-[11px]"
                aria-label={t("dataSources.pickModel")}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
        {field.type.kind === "enum" ? (
          <EnumValuesEditor
            values={field.type.values}
            onCommit={(values) => retype({ kind: "enum", values })}
          />
        ) : null}
        {isKeyField ? (
          <span className="badge text-[9px]" title={t("dataSources.keyFieldHint")}>
            {t("dataSources.keyField")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() =>
            editSourceField({ projectId, target, edit: { op: "remove", path, name: field.name } })
          }
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
          aria-label={t("dataSources.removeField", { name: field.name })}
        >
          ✕
        </button>
      </div>
      {nestedFields ? (
        <div className="ml-4 border-l border-[var(--border-soft)] pl-3">
          <FieldList
            projectId={projectId}
            target={target}
            project={project}
            path={nestedPath}
            fields={nestedFields}
            keyField={null}
          />
        </div>
      ) : null}
      {field.type.kind === "union" ? (
        <UnionShapeEditor type={field.type} models={models} onCommit={retype} labelFor={kindLabel} />
      ) : null}
    </li>
  );
}

function FieldList({
  projectId,
  target,
  project,
  path,
  fields,
  keyField,
}: {
  projectId: Project["id"];
  target: FieldEditTarget;
  project: Project;
  path: string[];
  fields: ModelField[];
  keyField: string | null;
}) {
  const { t } = useTranslation();
  const editSourceField = useAccountStore((s) => s.editSourceField);
  // The draft stays hidden behind a dashed "+ Add a field" button:
  // always-visible inputs looked like an already-added field row.
  const [draftOpen, setDraftOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<KindChoice>("string");
  const models = project.dataModels ?? [];

  const addField = () => {
    const clean = newName.trim();
    if (clean === "" || fields.some((f) => f.name === clean)) return;
    editSourceField({
      projectId,
      target,
      edit: { op: "add", path, field: { name: clean, type: defaultTypeForKind(newKind, models) } },
    });
    setNewName(""); // draft stays open — fast multi-add
  };
  const closeDraft = () => {
    setDraftOpen(false);
    setNewName("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1">
        {fields.map((f) => (
          <FieldRow
            key={f.name}
            projectId={projectId}
            target={target}
            project={project}
            path={path}
            field={f}
            isKeyField={keyField === f.name}
          />
        ))}
      </ul>
      {draftOpen ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addField();
              if (e.key === "Escape") closeDraft();
            }}
            placeholder={t("dataSources.fieldName")}
            className="h-7 w-36 px-2 font-mono text-[12px]"
          />
          <KindSelect
            value={newKind}
            allowComplex
            labelFor={(k) => t(`dataSources.kind.${k}`)}
            onChange={setNewKind}
          />
          <button
            type="button"
            onClick={addField}
            className="rounded px-1.5 py-0.5 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--success)]"
            aria-label={t("dataSources.confirmAddField")}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={closeDraft}
            className="rounded px-1.5 py-0.5 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
            aria-label={t("dataSources.cancelAddField")}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDraftOpen(true)}
          className="self-start rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {t("dataSources.addField")}
        </button>
      )}
    </div>
  );
}

export function ModelFieldsEditor({
  projectId,
  project,
  source,
}: {
  projectId: Project["id"];
  project: Project;
  source: Project["dataSources"][number];
}) {
  const { t } = useTranslation();
  const renameDataModel = useAccountStore((s) => s.renameDataModel);
  const setModelKeyField = useAccountStore((s) => s.setModelKeyField);
  const setSourceGranularity = useAccountStore((s) => s.setSourceGranularity);
  const models = project.dataModels ?? [];
  const model = source.shape === "table" ? models.find((m) => m.id === source.modelId) : null;
  const target: FieldEditTarget =
    source.shape === "table"
      ? { kind: "model", modelId: source.modelId }
      : { kind: "config", sourceId: source.id };
  const fields = sourceRootFields(project, source);
  // Row-key candidates: top-level scalar fields.
  const keyCandidates = fields
    .filter((f) => f.type.kind === "string" || f.type.kind === "number" || f.type.kind === "integer")
    .map((f) => f.name);

  // Module-declared model: the Add-on owns the shape — read-only for the admin
  // (ADR composable-data-models §4). Values stay editable through the row form.
  if (model?.provenance === "module") {
    return (
      <div className="flex flex-col gap-1.5" data-testid="model-fields-readonly">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{t("dataSources.modelName")}</span>
          <code className="font-mono text-[12px] text-[var(--text)]">{model.name}</code>
          <span className="badge text-[9px]" title={t("dataSources.declaredModelHint")}>
            {t("dataSources.declaredModel")}
          </span>
          {model.version !== undefined ? (
            <span className="text-[10px] text-[var(--text-faint)]">v{model.version}</span>
          ) : null}
        </div>
        <ul className="flex flex-col gap-0.5">
          {fields.map((f) => (
            <li key={f.name} className="flex items-center gap-2 text-[12px]">
              <code className="min-w-32 font-mono text-[var(--text)]">{f.name}</code>
              <span className="text-[11px] text-[var(--text-mut)]">
                {t(`dataSources.kind.${f.type.kind}`)}
              </span>
              {f.name === model.keyField ? (
                <span className="badge text-[9px]">{t("dataSources.keyField")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="model-fields-editor">
      {model ? (
        <div className="flex items-center gap-2">
          <span className="eyebrow">{t("dataSources.modelName")}</span>
          <Input
            defaultValue={model.name}
            key={model.id}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== model.name)
                renameDataModel({ projectId, modelId: model.id, newName: v });
            }}
            className="h-7 w-36 px-2 font-mono text-[12px]"
            aria-label={t("dataSources.modelName")}
          />
          <span className="eyebrow ml-2">{t("dataSources.keyField")}</span>
          <select
            value={model.keyField}
            onChange={(e) =>
              setModelKeyField({ projectId, modelId: model.id, keyField: e.target.value })
            }
            className="input h-7 w-auto px-1 font-mono text-[11px]"
            aria-label={t("dataSources.keyField")}
          >
            {keyCandidates.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="eyebrow ml-2">{t("dataSources.granularity")}</span>
          <select
            value={source.shape === "table" && source.granularity === "row" ? "row" : "single"}
            onChange={(e) =>
              setSourceGranularity({
                projectId,
                sourceId: source.id,
                granularity: e.target.value === "row" ? "row" : null,
              })
            }
            className="input h-7 w-auto px-1 text-[11px]"
            aria-label={t("dataSources.granularity")}
          >
            <option value="single">{t("dataSources.granularitySingle")}</option>
            <option value="row">{t("dataSources.granularityRow")}</option>
          </select>
        </div>
      ) : null}
      <FieldList
        projectId={projectId}
        target={target}
        project={project}
        path={[]}
        fields={fields}
        keyField={model?.keyField ?? null}
      />
    </div>
  );
}
