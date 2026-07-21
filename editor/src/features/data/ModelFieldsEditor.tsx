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
] as const;
type KindChoice = (typeof SCALAR_KINDS)[number] | "list" | "object" | "model";

function kindOf(t: ModelFieldType): KindChoice {
  return t.kind;
}

function defaultTypeForKind(kind: KindChoice, models: DataModel[]): ModelFieldType {
  switch (kind) {
    case "list":
      return { kind: "list", of: { kind: "string" } };
    case "object":
      return { kind: "object", fields: [] };
    case "model":
      return { kind: "model", ref: (models[0]?.id ?? "") as DataModelId };
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
    ? [...SCALAR_KINDS, "list", "object", "model"]
    : [...SCALAR_KINDS, "object", "model"];
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

function FieldRow({
  projectId,
  target,
  pack,
  path,
  field,
  isKeyField,
}: {
  projectId: Project["id"];
  target: FieldEditTarget;
  pack: Project;
  path: string[];
  field: ModelField;
  isKeyField: boolean;
}) {
  const { t } = useTranslation();
  const editSourceField = useAccountStore((s) => s.editSourceField);
  const [name, setName] = useState(field.name);
  const models = pack.dataModels ?? [];

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
  const nestedFields =
    field.type.kind === "object"
      ? field.type.fields
      : listElem?.kind === "object"
        ? listElem.fields
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
            pack={pack}
            path={nestedPath}
            fields={nestedFields}
            keyField={null}
          />
        </div>
      ) : null}
    </li>
  );
}

function FieldList({
  projectId,
  target,
  pack,
  path,
  fields,
  keyField,
}: {
  projectId: Project["id"];
  target: FieldEditTarget;
  pack: Project;
  path: string[];
  fields: ModelField[];
  keyField: string | null;
}) {
  const { t } = useTranslation();
  const editSourceField = useAccountStore((s) => s.editSourceField);
  // The draft stays hidden behind a dashed "+ Ajouter un champ" button:
  // always-visible inputs looked like an already-added field row.
  const [draftOpen, setDraftOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<KindChoice>("string");
  const models = pack.dataModels ?? [];

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
            pack={pack}
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
  pack,
  source,
}: {
  projectId: Project["id"];
  pack: Project;
  source: Project["dataSources"][number];
}) {
  const { t } = useTranslation();
  const renameDataModel = useAccountStore((s) => s.renameDataModel);
  const setModelKeyField = useAccountStore((s) => s.setModelKeyField);
  const models = pack.dataModels ?? [];
  const model = source.shape === "table" ? models.find((m) => m.id === source.modelId) : null;
  const target: FieldEditTarget =
    source.shape === "table"
      ? { kind: "model", modelId: source.modelId }
      : { kind: "config", sourceId: source.id };
  const fields = sourceRootFields(pack, source);
  // Row-key candidates: top-level scalar fields.
  const keyCandidates = fields
    .filter((f) => f.type.kind === "string" || f.type.kind === "number" || f.type.kind === "integer")
    .map((f) => f.name);

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
        </div>
      ) : null}
      <FieldList
        projectId={projectId}
        target={target}
        pack={pack}
        path={[]}
        fields={fields}
        keyField={model?.keyField ?? null}
      />
    </div>
  );
}
