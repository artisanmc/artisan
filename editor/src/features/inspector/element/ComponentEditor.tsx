import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { componentLook, knownComponents } from "@/domain/components";
import type { Appearance, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useComponentsFeed } from "@/features/assets/useComponentsFeed";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

type Component = NonNullable<Appearance["component"]>;
type Args = Record<string, unknown>;

/** The name a look's component is written with, and the parameters the look gives it. */
function read(component: Component): { name: string; args: Args } {
  if (typeof component === "string") return { name: component, args: {} };
  const { name, ...args } = component;
  return { name, args };
}

/** The name alone when the look gives no parameter. */
const write = (name: string, args: Args): Component =>
  Object.keys(args).length ? { name, ...args } : name;

/**
 * A look's component (ADR `element-parts-and-sliced-images`, decision 6): which one it names
 * and the parameters it gives it, or, for a look that names none, the choice of one and the
 * saving of its own pieces as a new component of the Project.
 */
export function ComponentEditor({
  projectId,
  appearance,
  lang,
  onComponent,
  onDetach,
  onSave,
}: {
  projectId: ProjectId;
  appearance: Appearance;
  /** The language a text parameter written per language is edited in. */
  lang: string;
  onComponent: (component: Component | null) => void;
  onDetach: (look: NonNullable<ReturnType<typeof componentLook>>) => void;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  useComponentsFeed();
  const known = knownComponents(projectId);
  const [picking, setPicking] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const perform = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const alert = error && (
    <p role="alert" className="text-xs text-[var(--danger)]">
      {error}
    </p>
  );

  if (appearance.component === undefined) {
    const draws = !!(appearance.parts?.length || appearance.image || appearance.label);
    if (!known.length && !draws) return null;
    return (
      <div className="flex flex-col gap-2">
        <span className="field-label !mb-0">{t("component.title")}</span>
        {known.length > 0 && (
          <select
            className="input w-full"
            aria-label={t("component.use")}
            value=""
            onChange={(event) => {
              const picked = event.target.value;
              if (picked) perform(() => onComponent(picked));
            }}
          >
            <option value="">{t("component.use")}</option>
            {known.map((component) => (
              <option key={component.name} value={component.name}>
                {component.common
                  ? t("component.common", { name: component.name })
                  : component.name}
              </option>
            ))}
          </select>
        )}
        {draws && (
          <div className="flex items-end gap-2">
            <label className="field-label !mb-0 flex-1" htmlFor={`${id}-name`}>
              {t("component.saveName")}
              <Input
                id={`${id}-name`}
                value={name}
                placeholder="confirm"
                onChange={(event) => setName(event.target.value.trim().toLowerCase())}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!name}
              onClick={() =>
                perform(() => {
                  onSave(name);
                  setName("");
                })
              }
            >
              {t("component.save")}
            </Button>
          </div>
        )}
        {draws && <p className="text-xs text-[var(--text-mut)]">{t("component.saveHint")}</p>}
        {alert}
      </div>
    );
  }

  const { name: current, args } = read(appearance.component);
  const found = known.find((component) => component.name === current);
  const look = componentLook(appearance, projectId);
  const set = (param: string, value: unknown) => {
    const next = { ...args };
    if (value === undefined || value === "") Reflect.deleteProperty(next, param);
    else next[param] = value;
    onComponent(write(current, next));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="field-label !mb-0">{t("component.named", { name: current })}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!look}
            title={t("component.detachHint")}
            onClick={() => look && perform(() => onDetach(look))}
          >
            {t("component.detach")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => perform(() => onComponent(null))}>
            {t("component.remove")}
          </Button>
        </div>
      </div>
      {!look && <p className="text-xs text-[var(--danger)]">{t("component.unknown")}</p>}
      {look && <p className="text-xs text-[var(--text-mut)]">{t("component.linked")}</p>}
      {found?.params.map((param) => {
        const given = args[param.name];
        const fallback = typeof param.default === "string" ? param.default : "";
        if (param.type === "choice")
          return (
            <label key={param.name} className="field-label !mb-0" htmlFor={`${id}-${param.name}`}>
              {param.name}
              <select
                id={`${id}-${param.name}`}
                className="input"
                value={typeof given === "string" && param.values?.includes(given) ? given : ""}
                onChange={(event) => perform(() => set(param.name, event.target.value))}
              >
                <option value="">
                  {fallback ? t("component.choiceDefault", { name: fallback }) : "-"}
                </option>
                {param.values?.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          );
        if (param.type === "image")
          return (
            <div key={param.name} className="flex items-end gap-2">
              <label className="field-label !mb-0 flex-1" htmlFor={`${id}-${param.name}`}>
                {param.name}
                <Input
                  id={`${id}-${param.name}`}
                  value={typeof given === "string" ? given : ""}
                  placeholder={fallback}
                  onChange={(event) => set(param.name, event.target.value.trim())}
                />
              </label>
              <Button size="sm" variant="outline" onClick={() => setPicking(param.name)}>
                {t("imageButton.choose")}
              </Button>
            </div>
          );
        const perLang = given !== null && typeof given === "object";
        const value = perLang
          ? ((given as Record<string, string>)[lang] ?? "")
          : given === undefined || given === null
            ? ""
            : String(given);
        return (
          <label key={param.name} className="field-label !mb-0" htmlFor={`${id}-${param.name}`}>
            {param.name}
            <Input
              id={`${id}-${param.name}`}
              value={value}
              placeholder={fallback}
              onChange={(event) => {
                const text = event.target.value;
                if (!perLang) return set(param.name, text);
                const texts = { ...(given as Record<string, string>) };
                if (text) texts[lang] = text;
                else Reflect.deleteProperty(texts, lang);
                set(param.name, Object.keys(texts).length ? texts : undefined);
              }}
            />
          </label>
        );
      })}
      {alert}
      <AssetPicker
        usage="button"
        named
        open={picking !== null}
        projectId={projectId}
        onClose={() => setPicking(null)}
        title={t("imageButton.choose")}
        onPick={(picked) =>
          perform(() => {
            if (picking) set(picking, picked.id);
            setPicking(null);
          })
        }
      />
    </div>
  );
}
